import { describe, it, expect } from "vitest";
import { selectNextReadyWorkUnit, resolveNextSelection } from "../../src/workflow/next-work-unit-selector.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

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

function makeDependency(overrides: Partial<Dependency> & { id: string; fromId: string; toId: string }): Dependency {
  return { type: "blocks", reason: null, ...overrides };
}

/** Two independent effectively ready branches: WU001/M001 and WU002/M002. */
function twoBranchState(): StateModel {
  const wu1 = makeWorkUnit({ id: "WU001", milestoneId: "M001", status: "ready", title: "Branch A entry" });
  const wu2 = makeWorkUnit({ id: "WU002", milestoneId: "M002", status: "ready", title: "Branch B entry" });
  const m1 = makeMilestone({ id: "M001", title: "Branch A", workUnitIds: ["WU001"] });
  const m2 = makeMilestone({ id: "M002", title: "Branch B", workUnitIds: ["WU002"] });
  return stateWithGraph([wu1, wu2], [m1, m2]);
}

describe("resolveNextSelection (M20 §8/§9/§10/§11)", () => {
  describe("default mode", () => {
    it("selects the first effectively ready candidate in stored order (unchanged default behavior)", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "default" });
      expect(result.selectedWorkUnit?.id).toBe("WU001");
      expect(result.blockingReason).toBeNull();
    });

    it("reports all effectively ready candidates as globalCandidates and scopedCandidates", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "default" });
      expect(result.globalCandidates.map((c) => c.workUnitId)).toEqual(["WU001", "WU002"]);
      expect(result.scopedCandidates).toEqual(result.globalCandidates);
    });

    it("returns a no-ready-candidate blocking reason when nothing is effectively ready", () => {
      const wu = makeWorkUnit({ id: "WU001", status: "planned" });
      const state = stateWithGraph([wu], [makeMilestone()]);
      const result = resolveNextSelection(state, { mode: "default" });
      expect(result.selectedWorkUnit).toBeNull();
      expect(result.blockingReason?.code).toBe("no-ready-candidate-in-scope");
    });

    it("excludes a stale-ready unit (canonically ready, unsatisfied dependency)", () => {
      const upstream = makeWorkUnit({ id: "WU-UP", milestoneId: "M001", status: "planned" });
      const stale = makeWorkUnit({
        id: "WU-STALE",
        milestoneId: "M001",
        status: "ready",
        dependencies: ["DEP-1"],
      });
      const dep = makeDependency({ id: "DEP-1", fromId: "WU-UP", toId: "WU-STALE", type: "blocks" });
      const state: StateModel = {
        ...stateWithGraph([upstream, stale], [makeMilestone({ workUnitIds: ["WU-UP", "WU-STALE"] })]),
        workGraph: {
          milestones: [makeMilestone({ workUnitIds: ["WU-UP", "WU-STALE"] })],
          workUnits: [upstream, stale],
          dependencies: [dep],
        },
      };
      const result = resolveNextSelection(state, { mode: "default" });
      expect(result.selectedWorkUnit).toBeNull();
      expect(result.globalCandidates).toEqual([]);
    });
  });

  describe("work_unit mode", () => {
    it("selects the requested unit even when it is not first in stored order", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "work_unit", workUnitId: "WU002" });
      expect(result.selectedWorkUnit?.id).toBe("WU002");
      expect(result.blockingReason).toBeNull();
    });

    it("leaves the earlier-order candidate out of scopedCandidates but still in globalCandidates", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "work_unit", workUnitId: "WU002" });
      expect(result.scopedCandidates.map((c) => c.workUnitId)).toEqual(["WU002"]);
      expect(result.globalCandidates.map((c) => c.workUnitId)).toEqual(["WU001", "WU002"]);
    });

    it("returns unknown-work-unit for a nonexistent id", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "work_unit", workUnitId: "WU999" });
      expect(result.selectedWorkUnit).toBeNull();
      expect(result.blockingReason?.code).toBe("unknown-work-unit");
    });

    it.each(["planned", "in_progress", "needs_review", "done", "replanned", "cancelled"] as const)(
      "returns not-effectively-ready for status %s",
      (status) => {
        const wu = makeWorkUnit({ id: "WU001", status });
        const state = stateWithGraph([wu], [makeMilestone()]);
        const result = resolveNextSelection(state, { mode: "work_unit", workUnitId: "WU001" });
        expect(result.selectedWorkUnit).toBeNull();
        expect(result.blockingReason?.code).toBe("not-effectively-ready");
        expect(result.blockingReason?.canonicalStatus).toBe(status);
      },
    );

    it("reports unsatisfied dependency ids and blocking predecessors for a stale-ready target", () => {
      const upstream = makeWorkUnit({ id: "WU-UP", status: "planned" });
      const stale = makeWorkUnit({ id: "WU-STALE", status: "ready", dependencies: ["DEP-1"] });
      const dep = makeDependency({ id: "DEP-1", fromId: "WU-UP", toId: "WU-STALE", type: "blocks" });
      const state: StateModel = {
        ...stateWithGraph([upstream, stale], [makeMilestone({ workUnitIds: ["WU-UP", "WU-STALE"] })]),
        workGraph: {
          milestones: [makeMilestone({ workUnitIds: ["WU-UP", "WU-STALE"] })],
          workUnits: [upstream, stale],
          dependencies: [dep],
        },
      };
      const result = resolveNextSelection(state, { mode: "work_unit", workUnitId: "WU-STALE" });
      expect(result.blockingReason?.code).toBe("not-effectively-ready");
      expect(result.blockingReason?.unsatisfiedDependencyIds).toEqual(["DEP-1"]);
      expect(result.blockingReason?.blockingPredecessorWorkUnitIds).toEqual(["WU-UP"]);
    });
  });

  describe("milestone mode", () => {
    it("selects the first effectively ready member of the milestone", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "milestone", milestoneId: "M002" });
      expect(result.selectedWorkUnit?.id).toBe("WU002");
      expect(result.selectedMilestone?.id).toBe("M002");
    });

    it("scopedCandidates contains only members of the requested milestone", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "milestone", milestoneId: "M001" });
      expect(result.scopedCandidates.map((c) => c.workUnitId)).toEqual(["WU001"]);
    });

    it("returns unknown-milestone for a nonexistent id", () => {
      const state = twoBranchState();
      const result = resolveNextSelection(state, { mode: "milestone", milestoneId: "M999" });
      expect(result.selectedWorkUnit).toBeNull();
      expect(result.blockingReason?.code).toBe("unknown-milestone");
    });

    it("returns no-ready-candidate-in-scope for an existing milestone with no ready member, never falling back globally", () => {
      const wu1 = makeWorkUnit({ id: "WU001", milestoneId: "M001", status: "planned" });
      const wu2 = makeWorkUnit({ id: "WU002", milestoneId: "M002", status: "ready" });
      const state = stateWithGraph(
        [wu1, wu2],
        [makeMilestone({ id: "M001", workUnitIds: ["WU001"] }), makeMilestone({ id: "M002", workUnitIds: ["WU002"] })],
      );
      const result = resolveNextSelection(state, { mode: "milestone", milestoneId: "M001" });
      expect(result.selectedWorkUnit).toBeNull();
      expect(result.blockingReason?.code).toBe("no-ready-candidate-in-scope");
    });
  });

  describe("preview/apply parity", () => {
    it("returns an identical selection for the same state and request across repeated calls", () => {
      const state = twoBranchState();
      const a = resolveNextSelection(state, { mode: "work_unit", workUnitId: "WU002" });
      const b = resolveNextSelection(state, { mode: "work_unit", workUnitId: "WU002" });
      expect(a.selectedWorkUnit?.id).toBe(b.selectedWorkUnit?.id);
      expect(a.globalCandidates).toEqual(b.globalCandidates);
    });
  });
});
