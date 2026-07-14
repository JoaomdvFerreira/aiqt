import { describe, it, expect } from "vitest";
import {
  collectSuspiciousLateStageReadinessWarnings,
  collectMixedInboundDependencyWarnings,
  collectOrphanedRequirementFragmentWarnings,
} from "../../src/workflow/warning-rules.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

function baseProject(overrides: Partial<ProjectModel> = {}): ProjectModel {
  return {
    version: "1.0.0",
    project: {
      id: "PROJECT-001",
      name: "Test",
      objective: "Ship it",
      targetUsers: ["devs"],
      preferredAgent: null,
      existingRepositoryPath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
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
    quality: {
      acceptanceCriteriaRequired: true,
      validationRequiredBeforeDone: true,
      preferredValidationCommands: [],
    },
    ...overrides,
  };
}

function wu(overrides: Partial<WorkUnit>): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "t",
    objective: "o",
    scope: ["s"],
    outOfScope: ["oos"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "in_progress",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: { milestones: [], workUnits: [], dependencies: [] },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("collectSuspiciousLateStageReadinessWarnings", () => {
  it("warns when a late-stage-keyword work unit is ready while core work is incomplete", () => {
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [
          wu({ id: "WU001", title: "Accessibility polish pass", status: "ready" }),
          wu({ id: "WU002", title: "Core checkout flow", status: "planned" }),
        ],
        dependencies: [],
      },
    });
    const findings = collectSuspiciousLateStageReadinessWarnings(state);
    expect(findings).toHaveLength(1);
    expect(findings[0].findingKey).toBe("workunit:WU001:suspicious-late-stage-ready");
    expect(findings[0].blocking).toBe(false);
  });

  it("does not warn when all non-late-stage work is already done", () => {
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [
          wu({ id: "WU001", title: "Production readiness pass", status: "ready" }),
          wu({ id: "WU002", title: "Core checkout flow", status: "done" }),
        ],
        dependencies: [],
      },
    });
    expect(collectSuspiciousLateStageReadinessWarnings(state)).toEqual([]);
  });

  it("does not warn when no work unit matches a late-stage keyword", () => {
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [wu({ id: "WU001", title: "Core checkout flow", status: "ready" })],
        dependencies: [],
      },
    });
    expect(collectSuspiciousLateStageReadinessWarnings(state)).toEqual([]);
  });
});

describe("collectMixedInboundDependencyWarnings", () => {
  function dep(overrides: Partial<Dependency>): Dependency {
    return { id: "DEP-001", fromId: "WU001", toId: "WU003", type: "blocks", reason: null, ...overrides };
  }

  it("warns when a work unit has both blocking and relates_to inbound dependencies", () => {
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [wu({ id: "WU003" })],
        dependencies: [
          dep({ id: "DEP-001", type: "blocks" }),
          dep({ id: "DEP-002", type: "relates_to" }),
        ],
      },
    });
    const findings = collectMixedInboundDependencyWarnings(state);
    expect(findings).toHaveLength(1);
    expect(findings[0].findingKey).toBe("dependency:DEP-002:mixed-inbound-dependency-type");
  });

  it("does not warn when only relates_to dependencies are inbound", () => {
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [wu({ id: "WU003" })],
        dependencies: [dep({ id: "DEP-002", type: "relates_to" })],
      },
    });
    expect(collectMixedInboundDependencyWarnings(state)).toEqual([]);
  });

  it("does not warn when only blocking dependencies are inbound", () => {
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [wu({ id: "WU003" })],
        dependencies: [dep({ id: "DEP-001", type: "blocks" })],
      },
    });
    expect(collectMixedInboundDependencyWarnings(state)).toEqual([]);
  });
});

describe("collectOrphanedRequirementFragmentWarnings", () => {
  it("warns when the only referencing work unit's scope is smaller than the requirement's acceptance criteria", () => {
    const project = baseProject({
      requirements: [
        {
          id: "REQ-001",
          title: "Full checkout",
          description: "d",
          priority: "medium",
          type: "functional",
          acceptanceCriteria: ["a", "b", "c"],
          status: "accepted",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [wu({ id: "WU001", agentContextRefs: ["REQ-001"], scope: ["s1"] })],
        dependencies: [],
      },
    });
    const findings = collectOrphanedRequirementFragmentWarnings(project, state);
    expect(findings).toHaveLength(1);
    expect(findings[0].findingKey).toBe("workunit:WU001:possible-orphaned-requirement-fragment");
  });

  it("does not warn when more than one work unit references the requirement", () => {
    const project = baseProject({
      requirements: [
        {
          id: "REQ-001",
          title: "Full checkout",
          description: "d",
          priority: "medium",
          type: "functional",
          acceptanceCriteria: ["a", "b", "c"],
          status: "accepted",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [
          wu({ id: "WU001", agentContextRefs: ["REQ-001"], scope: ["s1"] }),
          wu({ id: "WU002", agentContextRefs: ["REQ-001"], scope: ["s2"] }),
        ],
        dependencies: [],
      },
    });
    expect(collectOrphanedRequirementFragmentWarnings(project, state)).toEqual([]);
  });

  it("does not warn for a bare 'requirements' category ref", () => {
    const project = baseProject({
      requirements: [
        {
          id: "REQ-001",
          title: "Full checkout",
          description: "d",
          priority: "medium",
          type: "functional",
          acceptanceCriteria: ["a", "b", "c"],
          status: "accepted",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [wu({ id: "WU001", agentContextRefs: ["requirements"], scope: ["s1"] })],
        dependencies: [],
      },
    });
    expect(collectOrphanedRequirementFragmentWarnings(project, state)).toEqual([]);
  });
});
