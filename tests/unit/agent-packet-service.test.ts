import { describe, it, expect } from "vitest";
import {
  resolveAgentContextRefs,
  buildUnresolvedRefWarnings,
  buildPacketContext,
} from "../../src/services/agent-packet-service.js";
import { buildInitialProjectModel } from "../../src/state/project-store.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

function baseProject(): ProjectModel {
  return buildInitialProjectModel({
    id: "PROJECT-001",
    name: "demo",
    objective: "Ship it",
    targetUsers: ["devs"],
    preferredAgent: null,
    createdAt: T1,
  });
}

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "T",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "M001",
    title: "M",
    objective: "O",
    status: "ready",
    workUnitIds: ["WU001"],
    ...overrides,
  };
}

function stateWithGraph(workUnits: WorkUnit[], milestones: Milestone[], dependencies: Dependency[] = []): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workGraph: { milestones, workUnits, dependencies } };
}

describe("resolveAgentContextRefs", () => {
  it("resolves a bare category ref to all records of that type", () => {
    const project = baseProject();
    project.requirements = [
      { id: "REQ-001", title: "T", description: "D", priority: "medium", type: "functional", acceptanceCriteria: [], status: "accepted", createdAt: T1, updatedAt: T1 },
    ];
    const result = resolveAgentContextRefs(["requirements"], project);
    expect(result.requirements).toHaveLength(1);
    expect(result.unresolvedRefs).toEqual([]);
  });

  it("resolves a specific record id ref", () => {
    const project = baseProject();
    project.decisions = [
      { id: "D001", decision: "Use TS", reason: "", impact: "", status: "decided", date: "2026-01-01", createdAt: T1, updatedAt: T1 },
    ];
    const result = resolveAgentContextRefs(["D001"], project);
    expect(result.decisions.map((d) => d.id)).toEqual(["D001"]);
  });

  it("reports unresolved refs without throwing", () => {
    const project = baseProject();
    const result = resolveAgentContextRefs(["project.objective", "bogus-ref"], project);
    expect(result.unresolvedRefs).toEqual(["project.objective", "bogus-ref"]);
    expect(result.requirements).toEqual([]);
  });

  it("dedupes when a record is referenced twice", () => {
    const project = baseProject();
    project.risks = [
      { id: "RISK-001", title: "R", description: "D", severity: "medium", mitigation: null, status: "open", createdAt: T1, updatedAt: T1 },
    ];
    const result = resolveAgentContextRefs(["risks", "RISK-001"], project);
    expect(result.risks).toHaveLength(1);
  });

  it("RC1: a specific requirement id ref includes only that requirement, not the whole category", () => {
    const project = baseProject();
    project.requirements = [
      { id: "REQ-001", title: "Add item", description: "D1", priority: "high", type: "functional", acceptanceCriteria: [], status: "accepted", createdAt: T1, updatedAt: T1 },
      { id: "REQ-002", title: "Mark bought", description: "D2", priority: "medium", type: "functional", acceptanceCriteria: [], status: "accepted", createdAt: T1, updatedAt: T1 },
    ];
    const result = resolveAgentContextRefs(["REQ-001"], project);
    expect(result.requirements.map((r) => r.id)).toEqual(["REQ-001"]);
    expect(result.requirements.map((r) => r.id)).not.toContain("REQ-002");
  });
});

describe("buildUnresolvedRefWarnings", () => {
  it("builds one medium/context warning per unresolved ref", () => {
    const warnings = buildUnresolvedRefWarnings(["a", "b"]);
    expect(warnings).toHaveLength(2);
    for (const w of warnings) {
      expect(w.severity).toBe("medium");
      expect(w.area).toBe("context");
      expect(w.agentCanFix).toBe(false);
    }
  });

  it("builds no warnings for an empty list", () => {
    expect(buildUnresolvedRefWarnings([])).toEqual([]);
  });
});

describe("buildPacketContext", () => {
  it("includes only dependencies attached to the selected work unit", () => {
    const project = baseProject();
    const wu = makeWorkUnit({ dependencies: ["DEP-001"] });
    const milestone = makeMilestone();
    const dep: Dependency = { id: "DEP-001", fromId: "WU000", toId: "WU001", type: "blocks", reason: "x" };
    const unrelatedDep: Dependency = { id: "DEP-002", fromId: "WU005", toId: "WU006", type: "blocks", reason: null };
    const state = stateWithGraph([wu], [milestone], [dep, unrelatedDep]);
    const context = buildPacketContext(project, state, wu, milestone, {
      requirements: [], decisions: [], risks: [], assumptions: [], openQuestions: [], unresolvedRefs: [],
    });
    expect(context.dependencies).toEqual([dep]);
  });

  it("carries project and context fields into PacketContext", () => {
    const project = baseProject();
    project.context.constraints = ["local only"];
    const wu = makeWorkUnit();
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    const context = buildPacketContext(project, state, wu, milestone, {
      requirements: [], decisions: [], risks: [], assumptions: [], openQuestions: [], unresolvedRefs: [],
    });
    expect(context.projectObjective).toBe("Ship it");
    expect(context.targetUsers).toEqual(["devs"]);
    expect(context.constraints).toEqual(["local only"]);
    expect(context.workUnit.id).toBe("WU001");
    expect(context.milestone.id).toBe("M001");
  });
});
