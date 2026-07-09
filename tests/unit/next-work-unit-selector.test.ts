import { describe, it, expect } from "vitest";
import { selectNextReadyWorkUnit } from "../../src/workflow/next-work-unit-selector.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

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

function stateWithGraph(workUnits: WorkUnit[], milestones: Milestone[]): StateModel {
  const state = buildInitialStateModel(T1);
  return {
    ...state,
    workGraph: { milestones, workUnits, dependencies: [] },
  };
}

describe("selectNextReadyWorkUnit", () => {
  it("returns null when no work units exist", () => {
    const state = stateWithGraph([], []);
    expect(selectNextReadyWorkUnit(state)).toEqual({ workUnit: null, milestone: null });
  });

  it("selects the first ready work unit by stored order", () => {
    const wu1 = makeWorkUnit({ id: "WU001", status: "planned" });
    const wu2 = makeWorkUnit({ id: "WU002", status: "ready" });
    const wu3 = makeWorkUnit({ id: "WU003", status: "ready" });
    const state = stateWithGraph([wu1, wu2, wu3], [makeMilestone()]);
    const result = selectNextReadyWorkUnit(state);
    expect(result.workUnit?.id).toBe("WU002");
  });

  it("ignores planned/in_progress/done work units", () => {
    const wu1 = makeWorkUnit({ id: "WU001", status: "planned" });
    const wu2 = makeWorkUnit({ id: "WU002", status: "in_progress" });
    const wu3 = makeWorkUnit({ id: "WU003", status: "done" });
    const state = stateWithGraph([wu1, wu2, wu3], [makeMilestone()]);
    expect(selectNextReadyWorkUnit(state).workUnit).toBeNull();
  });

  it("resolves the milestone of the selected work unit", () => {
    const wu = makeWorkUnit({ milestoneId: "M002" });
    const milestone = makeMilestone({ id: "M002" });
    const state = stateWithGraph([wu], [milestone]);
    const result = selectNextReadyWorkUnit(state);
    expect(result.milestone?.id).toBe("M002");
  });

  it("returns a null milestone when the referenced milestone id does not exist", () => {
    const wu = makeWorkUnit({ milestoneId: "does-not-exist" });
    const state = stateWithGraph([wu], [makeMilestone()]);
    const result = selectNextReadyWorkUnit(state);
    expect(result.workUnit).not.toBeNull();
    expect(result.milestone).toBeNull();
  });
});
