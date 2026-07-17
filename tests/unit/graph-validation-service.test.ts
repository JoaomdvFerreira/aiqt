import { describe, it, expect } from "vitest";
import { validateGraph } from "../../src/services/graph-validation-service.js";
import { buildGraphRepairPlan } from "../../src/services/graph-repair-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../../src/schema/work-unit.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

function wu(id: string, status: WorkUnitStatus, overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id,
    milestoneId: "M001",
    title: id,
    objective: "o",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status,
    dependencies: [],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

function dep(id: string, fromId: string, toId: string, type: Dependency["type"]): Dependency {
  return { id, fromId, toId, type, reason: null };
}

function project(): ProjectModel {
  return {
    version: "1.0.0",
    project: {
      id: "PROJ-001",
      name: "Test",
      objective: "Ship it",
      targetUsers: ["devs"],
      preferredAgent: null,
      existingRepositoryPath: null,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    },
    context: {
      constraints: [],
      nonGoals: [],
      technologyPreferences: [],
      businessRules: [],
      architectureNotes: [],
    },
    requirements: [],
    decisions: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    quality: { preferredValidationCommands: [] },
  };
}

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "in_progress",
    currentMilestoneId: "M001",
    currentWorkUnitId: null,
    workGraph: {
      milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: [] }],
      workUnits: [],
      dependencies: [],
    },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateGraph", () => {
  it("detects broken work-unit/dependency references as blocking errors", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001"] }],
        workUnits: [wu("WU001", "ready", { milestoneId: "M999" })],
        dependencies: [dep("DEP-001", "WU001", "WU404", "blocks")],
      },
    });
    const result = validateGraph(project(), state, []);
    expect(result.blockingErrors.some((e) => e.rule === "broken-milestone-reference")).toBe(true);
    expect(result.blockingErrors.some((e) => e.rule === "broken-dependency-reference")).toBe(true);
  });

  it("detects a cycle in the blocking/requires dependency graph as a blocking error", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001", "WU002"] }],
        workUnits: [wu("WU001", "planned"), wu("WU002", "planned")],
        dependencies: [
          dep("DEP-001", "WU001", "WU002", "blocks"),
          dep("DEP-002", "WU002", "WU001", "blocks"),
        ],
      },
    });
    const result = validateGraph(project(), state, []);
    expect(result.blockingErrors.some((e) => e.rule === "dependency-cycle")).toBe(true);
  });

  it("detects mixed inbound relates_to + blocking dependency types as a warning", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001", "WU002", "WU003"] }],
        workUnits: [wu("WU001", "done"), wu("WU002", "done"), wu("WU003", "planned")],
        dependencies: [
          dep("DEP-001", "WU001", "WU003", "blocks"),
          dep("DEP-002", "WU002", "WU003", "relates_to"),
        ],
      },
    });
    const result = validateGraph(project(), state, []);
    expect(result.warnings.some((w) => w.rule === "mixed-inbound-dependency-types")).toBe(true);
  });

  it("detects stale readiness: a ready work unit whose blocking source is not done", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001", "WU002"] }],
        workUnits: [wu("WU001", "planned"), wu("WU002", "ready")],
        dependencies: [dep("DEP-001", "WU001", "WU002", "blocks")],
      },
    });
    const result = validateGraph(project(), state, []);
    expect(result.warnings.some((w) => w.rule === "stale-readiness" && w.workUnitId === "WU002")).toBe(true);
  });

  it("detects a late-stage relates_to dependency (DEP-031 pattern)", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001", "WU002"] }],
        workUnits: [
          wu("WU001", "ready", { title: "Public profile work" }),
          wu("WU002", "ready", { title: "i18n readiness pass" }),
        ],
        dependencies: [dep("DEP-001", "WU001", "WU002", "relates_to")],
      },
    });
    const result = validateGraph(project(), state, []);
    expect(result.warnings.some((w) => w.rule === "late-stage-relates-to" && w.dependencyId === "DEP-001")).toBe(
      true,
    );
  });

  it("returns no findings for a clean, structurally valid graph", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "done", workUnitIds: ["WU001"] }],
        workUnits: [wu("WU001", "done")],
        dependencies: [],
      },
    });
    const result = validateGraph(project(), state, []);
    expect(result.blockingErrors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("buildGraphRepairPlan", () => {
  it("proposes a deterministic, copy-paste-runnable dependency update for a late-stage-relates-to warning", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001", "WU002"] }],
        workUnits: [
          wu("WU001", "ready", { title: "Public profile work" }),
          wu("WU002", "ready", { title: "i18n readiness pass" }),
        ],
        dependencies: [dep("DEP-001", "WU001", "WU002", "relates_to")],
      },
    });
    const validation = validateGraph(project(), state, []);
    const plan = buildGraphRepairPlan(validation, state);

    expect(plan.wouldMutate).toBe(false);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0].dependencyId).toBe("DEP-001");
    expect(plan.suggestions[0].recommendedCommand).toContain("aiqt dependency update DEP-001 --type blocks");
  });

  it("falls back to investigation guidance when no deterministic suggestion exists", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001", "WU002", "WU003"] }],
        workUnits: [wu("WU001", "done"), wu("WU002", "done"), wu("WU003", "planned")],
        dependencies: [
          dep("DEP-001", "WU001", "WU003", "blocks"),
          dep("DEP-002", "WU002", "WU003", "relates_to"),
        ],
      },
    });
    const validation = validateGraph(project(), state, []);
    const plan = buildGraphRepairPlan(validation, state);

    expect(plan.suggestions).toEqual([]);
    expect(plan.investigationGuidance.length).toBeGreaterThan(0);
  });

  it("never mutates: is a pure function of its input validation result", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "M", objective: "o", status: "done", workUnitIds: ["WU001"] }],
        workUnits: [wu("WU001", "done")],
        dependencies: [],
      },
    });
    const validation = validateGraph(project(), state, []);
    const first = buildGraphRepairPlan(validation, state);
    const second = buildGraphRepairPlan(validation, state);
    expect(first).toEqual(second);
  });
});
