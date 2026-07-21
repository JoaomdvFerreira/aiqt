import { describe, it, expect } from "vitest";
import { buildWorkGraphFromPlanInput } from "../../src/services/planning-service.js";
import { buildPlanAppend, buildPlanRefinement } from "../../src/services/plan-extension-service.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import type { PlanInput } from "../../src/schema/plan-input.schema.js";
import type { PlanAppendInput, PlanExtensionInput } from "../../src/schema/plan-extension-input.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function isolatedMetadata(assignmentKey: string) {
  return {
    workspaceAssignment: { mode: "isolated" as const, assignmentKey, access: "read_write" as const },
    parallelPolicy: { mode: "eligible_if_no_conflict" as const, resourceClaims: [] },
  };
}

function baseWorkUnit(overrides: Partial<PlanInput["workUnits"][number]> = {}) {
  return {
    clientKey: "wu1",
    milestoneClientKey: "m1",
    title: "WU1",
    objective: "Objective",
    scope: ["scope"],
    outOfScope: ["out"],
    acceptanceCriteria: ["criterion"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    ...overrides,
  };
}

function basePlan(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    milestones: [{ clientKey: "m1", title: "M1", objective: "Obj" }],
    workUnits: [baseWorkUnit()],
    dependencies: [],
    ...overrides,
  };
}

describe("buildWorkGraphFromPlanInput: M24 execution metadata (WU24-02)", () => {
  it("threads executionMetadata from plan input onto the constructed WorkUnit", () => {
    const plan = basePlan({ workUnits: [baseWorkUnit({ executionMetadata: isolatedMetadata("wu-1") })] });
    const result = buildWorkGraphFromPlanInput(plan, T1);
    expect(result.workUnits[0].executionMetadata?.workspaceAssignment?.mode).toBe("isolated");
  });

  it("leaves executionMetadata undefined when the input omits it (conservative absence)", () => {
    const result = buildWorkGraphFromPlanInput(basePlan(), T1);
    expect(result.workUnits[0].executionMetadata).toBeUndefined();
  });

  it("rejects a plan whose isolated assignmentKey is reused by two non-terminal work units, with no partial mutation", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1", executionMetadata: isolatedMetadata("shared-slot") }),
        baseWorkUnit({ clientKey: "wu2", executionMetadata: isolatedMetadata("shared-slot") }),
      ],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
    try {
      buildWorkGraphFromPlanInput(plan, T1);
    } catch (err) {
      expect((err as AiqtError).exitCode).toBe(3);
    }
  });

  it("allows two work units to share the same 'shared' mode assignmentKey", () => {
    const shared = {
      workspaceAssignment: { mode: "shared" as const, assignmentKey: "team-a", access: "read_write" as const },
    };
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1", executionMetadata: shared }),
        baseWorkUnit({ clientKey: "wu2", executionMetadata: shared }),
      ],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).not.toThrow();
  });
});

function stateWithWorkUnits(overrides: Partial<StateModel> = {}): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, ...overrides };
}

describe("buildPlanAppend: M24 execution metadata (WU24-02)", () => {
  it("threads executionMetadata onto newly appended work units", () => {
    const initial = buildWorkGraphFromPlanInput(basePlan(), T1);
    const state = stateWithWorkUnits({
      workGraph: { milestones: initial.milestones, workUnits: initial.workUnits, dependencies: [] },
    });
    const appendInput: PlanAppendInput = {
      milestones: [],
      workUnits: [baseWorkUnit({ clientKey: "wu2", milestoneClientKey: initial.milestones[0].id, executionMetadata: isolatedMetadata("wu-2") })],
      dependencies: [],
    };
    const outcome = buildPlanAppend({ state, input: appendInput, timestamp: T2 });
    const appended = outcome.state.workGraph.workUnits.find((wu) => wu.id === outcome.addedWorkUnitIds[0]);
    expect(appended?.executionMetadata?.workspaceAssignment?.mode).toBe("isolated");
  });

  it("rejects an append that reuses an isolated key already held by an existing non-terminal work unit", () => {
    const initial = buildWorkGraphFromPlanInput(
      basePlan({ workUnits: [baseWorkUnit({ executionMetadata: isolatedMetadata("dup-key") })] }),
      T1,
    );
    const state = stateWithWorkUnits({
      workGraph: { milestones: initial.milestones, workUnits: initial.workUnits, dependencies: [] },
    });
    const appendInput: PlanAppendInput = {
      milestones: [],
      workUnits: [
        baseWorkUnit({
          clientKey: "wu2",
          milestoneClientKey: initial.milestones[0].id,
          executionMetadata: isolatedMetadata("dup-key"),
        }),
      ],
      dependencies: [],
    };
    expect(() => buildPlanAppend({ state, input: appendInput, timestamp: T2 })).toThrow(AiqtError);
  });

  it("does not mutate the original state object on rejection (no partial graph mutation)", () => {
    const initial = buildWorkGraphFromPlanInput(
      basePlan({ workUnits: [baseWorkUnit({ executionMetadata: isolatedMetadata("dup-key") })] }),
      T1,
    );
    const state = stateWithWorkUnits({
      workGraph: { milestones: initial.milestones, workUnits: initial.workUnits, dependencies: [] },
    });
    const before = JSON.stringify(state);
    const appendInput: PlanAppendInput = {
      milestones: [],
      workUnits: [
        baseWorkUnit({
          clientKey: "wu2",
          milestoneClientKey: initial.milestones[0].id,
          executionMetadata: isolatedMetadata("dup-key"),
        }),
      ],
      dependencies: [],
    };
    try {
      buildPlanAppend({ state, input: appendInput, timestamp: T2 });
    } catch {
      /* expected */
    }
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("buildPlanRefinement: M24 execution metadata (WU24-02)", () => {
  function setupRefinableState() {
    const initial = buildWorkGraphFromPlanInput(
      basePlan({ workUnits: [baseWorkUnit({ executionMetadata: isolatedMetadata("original-key") })] }),
      T1,
    );
    return stateWithWorkUnits({
      workGraph: { milestones: initial.milestones, workUnits: initial.workUnits, dependencies: [] },
    });
  }

  it("threads executionMetadata onto newly refined-in replacement work units", () => {
    const state = setupRefinableState();
    const targetId = state.workGraph.workUnits[0].id;
    const refinementInput: PlanExtensionInput = {
      extension: { entryWorkUnitClientKeys: ["r1"], exitWorkUnitClientKeys: ["r1"], reason: "split" },
      milestones: [{ clientKey: "new-m", title: "New Milestone", objective: "Obj" }],
      workUnits: [
        baseWorkUnit({ clientKey: "r1", milestoneClientKey: "new-m", executionMetadata: isolatedMetadata("new-key") }),
      ],
      dependencies: [],
    };
    const outcome = buildPlanRefinement({ state, targetWorkUnitId: targetId, input: refinementInput, timestamp: T2 });
    const replacement = outcome.state.workGraph.workUnits.find((wu) => wu.id === outcome.addedWorkUnitIds[0]);
    expect(replacement?.executionMetadata?.workspaceAssignment?.assignmentKey).toBe("new-key");
  });

  it("preserves the replanned original's own executionMetadata (never rewritten)", () => {
    const state = setupRefinableState();
    const targetId = state.workGraph.workUnits[0].id;
    const refinementInput: PlanExtensionInput = {
      extension: { entryWorkUnitClientKeys: ["r1"], exitWorkUnitClientKeys: ["r1"], reason: "split" },
      milestones: [{ clientKey: "new-m", title: "New Milestone", objective: "Obj" }],
      workUnits: [baseWorkUnit({ clientKey: "r1", milestoneClientKey: "new-m" })],
      dependencies: [],
    };
    const outcome = buildPlanRefinement({ state, targetWorkUnitId: targetId, input: refinementInput, timestamp: T2 });
    const original = outcome.state.workGraph.workUnits.find((wu) => wu.id === targetId);
    expect(original?.status).toBe("replanned");
    expect(original?.executionMetadata?.workspaceAssignment?.assignmentKey).toBe("original-key");
  });

  it("allows a replacement to reuse the original's isolated key, since the original becomes terminal (replanned)", () => {
    const state = setupRefinableState();
    const targetId = state.workGraph.workUnits[0].id;
    const refinementInput: PlanExtensionInput = {
      extension: { entryWorkUnitClientKeys: ["r1"], exitWorkUnitClientKeys: ["r1"], reason: "split" },
      milestones: [{ clientKey: "new-m", title: "New Milestone", objective: "Obj" }],
      workUnits: [
        baseWorkUnit({
          clientKey: "r1",
          milestoneClientKey: "new-m",
          executionMetadata: isolatedMetadata("original-key"),
        }),
      ],
      dependencies: [],
    };
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: targetId, input: refinementInput, timestamp: T2 }),
    ).not.toThrow();
  });

  it("rejects a refinement whose two new replacement work units reuse the same isolated key", () => {
    const state = setupRefinableState();
    const targetId = state.workGraph.workUnits[0].id;
    const refinementInput: PlanExtensionInput = {
      extension: { entryWorkUnitClientKeys: ["r1"], exitWorkUnitClientKeys: ["r2"], reason: "split" },
      milestones: [{ clientKey: "new-m", title: "New Milestone", objective: "Obj" }],
      workUnits: [
        baseWorkUnit({ clientKey: "r1", milestoneClientKey: "new-m", executionMetadata: isolatedMetadata("dup") }),
        baseWorkUnit({ clientKey: "r2", milestoneClientKey: "new-m", executionMetadata: isolatedMetadata("dup") }),
      ],
      dependencies: [{ fromClientKey: "r1", toClientKey: "r2", type: "blocks" }],
    };
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: targetId, input: refinementInput, timestamp: T2 }),
    ).toThrow(AiqtError);
  });
});
