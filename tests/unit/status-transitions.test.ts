import { describe, it, expect } from "vitest";
import { applyWorkUnitStartTransition } from "../../src/workflow/status-transitions.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

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
    workUnitIds: ["WU001", "WU002"],
    ...overrides,
  };
}

function stateWithGraph(workUnits: WorkUnit[], milestones: Milestone[]): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workGraph: { milestones, workUnits, dependencies: [] } };
}

describe("applyWorkUnitStartTransition", () => {
  it("moves only the selected work unit from ready to in_progress", () => {
    const wu1 = makeWorkUnit({ id: "WU001" });
    const wu2 = makeWorkUnit({ id: "WU002" });
    const state = stateWithGraph([wu1, wu2], [makeMilestone()]);
    const result = applyWorkUnitStartTransition(state, "WU001", "M001", T2);
    expect(result.workUnits.find((wu) => wu.id === "WU001")?.status).toBe("in_progress");
    expect(result.workUnits.find((wu) => wu.id === "WU002")?.status).toBe("ready");
  });

  it("bumps updatedAt only on the selected work unit", () => {
    const wu1 = makeWorkUnit({ id: "WU001" });
    const wu2 = makeWorkUnit({ id: "WU002" });
    const state = stateWithGraph([wu1, wu2], [makeMilestone()]);
    const result = applyWorkUnitStartTransition(state, "WU001", "M001", T2);
    expect(result.workUnits.find((wu) => wu.id === "WU001")?.updatedAt).toBe(T2);
    expect(result.workUnits.find((wu) => wu.id === "WU002")?.updatedAt).toBe(T1);
  });

  it("moves the selected work unit's milestone from ready to in_progress", () => {
    const wu = makeWorkUnit();
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    const result = applyWorkUnitStartTransition(state, "WU001", "M001", T2);
    expect(result.milestones[0].status).toBe("in_progress");
  });

  it("leaves other milestones untouched", () => {
    const wu1 = makeWorkUnit({ id: "WU001", milestoneId: "M001" });
    const wu2 = makeWorkUnit({ id: "WU002", milestoneId: "M002" });
    const m1 = makeMilestone({ id: "M001", workUnitIds: ["WU001"] });
    const m2 = makeMilestone({ id: "M002", workUnitIds: ["WU002"] });
    const state = stateWithGraph([wu1, wu2], [m1, m2]);
    const result = applyWorkUnitStartTransition(state, "WU001", "M001", T2);
    expect(result.milestones.find((m) => m.id === "M001")?.status).toBe("in_progress");
    expect(result.milestones.find((m) => m.id === "M002")?.status).toBe("ready");
  });
});
