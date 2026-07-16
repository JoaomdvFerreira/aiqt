import { describe, it, expect } from "vitest";
import {
  findTargetWorkUnit,
  checkTargetEligibility,
  buildPlanRefinement,
} from "../../src/services/plan-extension-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import type { PlanExtensionInput } from "../../src/schema/plan-extension-input.schema.js";

const TS = "2026-01-01T00:00:00.000Z";

function makeWorkUnit(overrides: Partial<WorkUnit> & { id: string; milestoneId: string }): WorkUnit {
  return {
    title: `Title ${overrides.id}`,
    objective: "Objective.",
    scope: ["Scope item"],
    outOfScope: ["Out of scope item"],
    acceptanceCriteria: ["Criterion"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Milestone> & { id: string }): Milestone {
  return {
    title: `Milestone ${overrides.id}`,
    objective: "Milestone objective.",
    status: "ready",
    workUnitIds: [],
    ...overrides,
  };
}

function makeDependency(overrides: Partial<Dependency> & { id: string; fromId: string; toId: string }): Dependency {
  return { type: "blocks", reason: null, ...overrides };
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
    lastUpdatedAt: TS,
    ...overrides,
  };
}

/** A minimal graph: WU-A (done) --blocks--> WU-TARGET (refinable) --blocks--> WU-DOWN (planned). */
function stateWithTarget(targetStatus: WorkUnit["status"] = "ready"): StateModel {
  const wuA = makeWorkUnit({ id: "WU-A", milestoneId: "M-A", status: "done", dependencies: [] });
  const wuTarget = makeWorkUnit({
    id: "WU-TARGET",
    milestoneId: "M-TARGET",
    status: targetStatus,
    dependencies: ["DEP-1"],
  });
  const wuDown = makeWorkUnit({
    id: "WU-DOWN",
    milestoneId: "M-DOWN",
    status: "planned",
    dependencies: ["DEP-2"],
  });
  return baseState({
    workGraph: {
      milestones: [
        makeMilestone({ id: "M-A", workUnitIds: ["WU-A"], status: "done" }),
        makeMilestone({ id: "M-TARGET", workUnitIds: ["WU-TARGET"], status: targetStatus === "ready" ? "ready" : "planned" }),
        makeMilestone({ id: "M-DOWN", workUnitIds: ["WU-DOWN"], status: "planned" }),
      ],
      workUnits: [wuA, wuTarget, wuDown],
      dependencies: [
        makeDependency({ id: "DEP-1", fromId: "WU-A", toId: "WU-TARGET", type: "blocks" }),
        makeDependency({ id: "DEP-2", fromId: "WU-TARGET", toId: "WU-DOWN", type: "blocks" }),
      ],
    },
  });
}

function validRefinementInput(overrides: Partial<PlanExtensionInput> = {}): PlanExtensionInput {
  return {
    extension: {
      entryWorkUnitClientKeys: ["e1"],
      exitWorkUnitClientKeys: ["e2"],
      reason: "Detail the next bounded piece of work.",
    },
    milestones: [{ clientKey: "new-m", title: "New Milestone", objective: "New milestone objective." }],
    workUnits: [
      {
        clientKey: "e1",
        milestoneClientKey: "new-m",
        title: "Entry work unit",
        objective: "Entry objective.",
        scope: ["Scope"],
        outOfScope: ["Out of scope"],
        acceptanceCriteria: ["Criterion"],
        agentContextRefs: [],
        suggestedFiles: [],
        validationCommands: ["pnpm test"],
      },
      {
        clientKey: "e2",
        milestoneClientKey: "new-m",
        title: "Exit work unit",
        objective: "Exit objective.",
        scope: ["Scope"],
        outOfScope: ["Out of scope"],
        acceptanceCriteria: ["Criterion"],
        agentContextRefs: [],
        suggestedFiles: [],
        validationCommands: ["pnpm test"],
      },
    ],
    dependencies: [{ fromClientKey: "e1", toClientKey: "e2", type: "blocks" }],
    ...overrides,
  };
}

describe("findTargetWorkUnit", () => {
  it("finds a work unit by id", () => {
    const state = stateWithTarget();
    expect(findTargetWorkUnit(state, "WU-TARGET")?.id).toBe("WU-TARGET");
  });

  it("returns null for an unknown id", () => {
    const state = stateWithTarget();
    expect(findTargetWorkUnit(state, "WU-UNKNOWN")).toBeNull();
  });
});

describe("checkTargetEligibility", () => {
  it.each(["ready", "planned"] as const)("is eligible when status is %s", (status) => {
    const state = stateWithTarget(status);
    const wu = findTargetWorkUnit(state, "WU-TARGET")!;
    expect(checkTargetEligibility(state, wu)).toEqual({ eligible: true });
  });

  it.each(["in_progress", "needs_review", "done", "replanned", "cancelled"] as const)(
    "is ineligible when status is %s",
    (status) => {
      const state = stateWithTarget(status);
      const wu = findTargetWorkUnit(state, "WU-TARGET")!;
      const result = checkTargetEligibility(state, wu);
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.code).toBe("PLAN-EXTEND-TARGET-INELIGIBLE");
    },
  );

  it("is ineligible when it already has replacement metadata", () => {
    const state = stateWithTarget("planned");
    const wu = { ...findTargetWorkUnit(state, "WU-TARGET")!, replacedByWorkUnitIds: ["WU-X"] };
    const result = checkTargetEligibility(state, wu);
    expect(result.eligible).toBe(false);
  });

  it("is ineligible when it is the current in-progress work unit", () => {
    const state = { ...stateWithTarget("ready"), currentWorkUnitId: "WU-TARGET" };
    const wu = findTargetWorkUnit(state, "WU-TARGET")!;
    const result = checkTargetEligibility(state, wu);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe("PLAN-EXTEND-TARGET-HAS-HISTORY");
  });

  it("is ineligible when it already has a checkpoint", () => {
    const state = stateWithTarget("ready");
    const withCheckpoint = {
      ...state,
      checkpoints: [
        {
          id: "CP-1",
          workUnitId: "WU-TARGET",
          packetId: null,
          summary: "s",
          completed: [],
          notCompleted: [],
          filesChanged: [],
          issues: [],
          validationResult: "passed" as const,
          acceptanceCriteriaResult: "passed" as const,
          validationCommands: [],
          acceptanceCriteria: [],
          finalWorkUnitStatus: "done" as const,
          nextRecommendation: "aiqt next",
          createdAt: TS,
        },
      ],
    };
    const wu = findTargetWorkUnit(withCheckpoint, "WU-TARGET")!;
    const result = checkTargetEligibility(withCheckpoint, wu);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe("PLAN-EXTEND-TARGET-HAS-HISTORY");
  });

  it("is ineligible when it has an active agent packet", () => {
    const state = stateWithTarget("ready");
    const withPacket: StateModel = {
      ...state,
      lastAgentPacket: {
        id: "PKT-001",
        workUnitId: "WU-TARGET",
        milestoneId: "M-TARGET",
        createdAt: TS,
        format: "markdown",
        contentHash: "abc",
        sourceCommand: "aiqt next",
      },
    };
    const wu = findTargetWorkUnit(withPacket, "WU-TARGET")!;
    const result = checkTargetEligibility(withPacket, wu);
    expect(result.eligible).toBe(false);
  });
});

describe("buildPlanRefinement", () => {
  it("throws PLAN-EXTEND-TARGET-NOT-FOUND for an unknown target", () => {
    const state = stateWithTarget();
    expect(() =>
      buildPlanRefinement({
        state,
        targetWorkUnitId: "WU-UNKNOWN",
        input: validRefinementInput(),
        timestamp: TS,
      }),
    ).toThrowError(/not found/i);
  });

  it("marks the target replanned and preserves it in canonical state", () => {
    const state = stateWithTarget("ready");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const target = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU-TARGET")!;
    expect(target.status).toBe("replanned");
    expect(target.replanReason).toBe("Detail the next bounded piece of work.");
    expect(target.replacedByWorkUnitIds).toEqual(outcome.addedWorkUnitIds);
  });

  it("allocates deterministic canonical IDs continuing from the highest existing ID", () => {
    const state = stateWithTarget("ready");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    // Existing ids use a non-numeric prefix in this synthetic fixture, so
    // canonical M/WU/DEP allocation starts fresh at 001.
    expect(outcome.addedMilestoneIds).toEqual(["M001"]);
    expect(outcome.addedWorkUnitIds).toEqual(["WU001", "WU002"]);
  });

  it("copies an incoming blocks dependency to every entry, preserving type", () => {
    const state = stateWithTarget("planned");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const entryId = outcome.entryWorkUnitIds[0];
    const copied = outcome.state.workGraph.dependencies.find(
      (d) => d.id === outcome.copiedIncomingDependencyIds[0],
    )!;
    expect(copied.fromId).toBe("WU-A");
    expect(copied.toId).toBe(entryId);
    expect(copied.type).toBe("blocks");
  });

  it("copies an incoming requires dependency to every entry, preserving type", () => {
    const state = stateWithTarget("planned");
    state.workGraph.dependencies[0] = { ...state.workGraph.dependencies[0], type: "requires" };
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const copied = outcome.state.workGraph.dependencies.find(
      (d) => d.id === outcome.copiedIncomingDependencyIds[0],
    )!;
    expect(copied.type).toBe("requires");
  });

  it("copies an outgoing blocks dependency from every exit, preserving type", () => {
    const state = stateWithTarget("ready");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const exitId = outcome.exitWorkUnitIds[0];
    const copied = outcome.state.workGraph.dependencies.find(
      (d) => d.id === outcome.copiedOutgoingDependencyIds[0],
    )!;
    expect(copied.fromId).toBe(exitId);
    expect(copied.toId).toBe("WU-DOWN");
    expect(copied.type).toBe("blocks");
  });

  it("copies an outgoing requires dependency from every exit, preserving type", () => {
    const state = stateWithTarget("ready");
    state.workGraph.dependencies[1] = { ...state.workGraph.dependencies[1], type: "requires" };
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const copied = outcome.state.workGraph.dependencies.find(
      (d) => d.id === outcome.copiedOutgoingDependencyIds[0],
    )!;
    expect(copied.type).toBe("requires");
  });

  it("does not copy a relates_to relationship and it does not affect readiness", () => {
    const state = stateWithTarget("ready");
    state.workGraph.dependencies[1] = { ...state.workGraph.dependencies[1], type: "relates_to" };
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    expect(outcome.copiedOutgoingDependencyIds).toHaveLength(0);
    const down = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU-DOWN")!;
    // No blocking dependency at all now (relates_to only) -> ready.
    expect(down.status).toBe("ready");
  });

  it("preserves the original incoming/outgoing dependency records for audit history", () => {
    const state = stateWithTarget("ready");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    expect(outcome.state.workGraph.dependencies.some((d) => d.id === "DEP-1")).toBe(true);
    expect(outcome.state.workGraph.dependencies.some((d) => d.id === "DEP-2")).toBe(true);
  });

  it("does not let downstream work become ready merely because the target is replanned", () => {
    const state = stateWithTarget("ready");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const down = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU-DOWN")!;
    // The new exit work unit is not done yet, so downstream must stay blocked.
    expect(down.status).toBe("planned");
  });

  it("makes the first replacement entry ready when its copied incoming dependency source is already done", () => {
    const state = stateWithTarget("ready");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const entry = outcome.state.workGraph.workUnits.find((wu) => wu.id === outcome.entryWorkUnitIds[0])!;
    expect(entry.status).toBe("ready");
    const nonEntry = outcome.state.workGraph.workUnits.find((wu) => wu.id === outcome.addedWorkUnitIds[1])!;
    expect(nonEntry.status).toBe("planned");
  });

  it("uses AND semantics for multiple exits: downstream waits for every exit's copied dependency", () => {
    const state = stateWithTarget("ready");
    const input = validRefinementInput({
      extension: {
        entryWorkUnitClientKeys: ["e1"],
        exitWorkUnitClientKeys: ["e1", "e2"],
        reason: "Two independent exits.",
      },
      dependencies: [],
    });
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input,
      timestamp: TS,
    });
    expect(outcome.copiedOutgoingDependencyIds).toHaveLength(2);
    const down = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU-DOWN")!;
    expect(down.status).toBe("planned");
    expect(down.dependencies.filter((id) => outcome.copiedOutgoingDependencyIds.includes(id))).toHaveLength(2);
  });

  it("rejects a duplicate milestone clientKey", () => {
    const state = stateWithTarget("ready");
    const input = validRefinementInput({
      milestones: [
        { clientKey: "new-m", title: "A", objective: "A." },
        { clientKey: "new-m", title: "B", objective: "B." },
      ],
    });
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: "WU-TARGET", input, timestamp: TS }),
    ).toThrowError(/duplicate/i);
  });

  it("rejects a duplicate work-unit clientKey", () => {
    const state = stateWithTarget("ready");
    const input = validRefinementInput();
    input.workUnits.push({ ...input.workUnits[0] });
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: "WU-TARGET", input, timestamp: TS }),
    ).toThrowError(/duplicate/i);
  });

  it("rejects an entry key that does not reference a work unit in the payload", () => {
    const state = stateWithTarget("ready");
    const input = validRefinementInput({
      extension: {
        entryWorkUnitClientKeys: ["does-not-exist"],
        exitWorkUnitClientKeys: ["e2"],
        reason: "x",
      },
    });
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: "WU-TARGET", input, timestamp: TS }),
    ).toThrowError(/entry/i);
  });

  it("rejects an exit key that does not reference a work unit in the payload", () => {
    const state = stateWithTarget("ready");
    const input = validRefinementInput({
      extension: {
        entryWorkUnitClientKeys: ["e1"],
        exitWorkUnitClientKeys: ["does-not-exist"],
        reason: "x",
      },
    });
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: "WU-TARGET", input, timestamp: TS }),
    ).toThrowError(/exit/i);
  });

  it("rejects a dependency referencing a work unit outside the new payload", () => {
    const state = stateWithTarget("ready");
    const input = validRefinementInput({
      dependencies: [{ fromClientKey: "e1", toClientKey: "unknown-key", type: "blocks" }],
    });
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: "WU-TARGET", input, timestamp: TS }),
    ).toThrowError(/unknown|outside/i);
  });

  it("rejects a self-dependency", () => {
    const state = stateWithTarget("ready");
    const input = validRefinementInput({
      dependencies: [{ fromClientKey: "e1", toClientKey: "e1", type: "blocks" }],
    });
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: "WU-TARGET", input, timestamp: TS }),
    ).toThrowError(/itself/i);
  });

  it("rejects a cycle that only exists once the new nodes are combined with the existing graph", () => {
    const state = stateWithTarget("ready");
    // The existing graph alone (WU-A -> WU-TARGET -> WU-DOWN) is a simple,
    // acyclic chain. Deterministic ID allocation (verified separately)
    // assigns the first new entry work unit "WU001" -- pre-wiring an
    // existing dependency from WU-DOWN to that not-yet-created id produces
    // WU-DOWN -> WU001 -> WU002 -> WU-DOWN (via the entry->exit payload
    // dependency and the exit's copied outgoing dependency back to
    // WU-DOWN): a cycle that exists only once old and new nodes combine.
    state.workGraph.dependencies.push(
      makeDependency({ id: "DEP-LOOP", fromId: "WU-DOWN", toId: "WU001", type: "blocks" }),
    );
    const input = validRefinementInput();
    expect(() =>
      buildPlanRefinement({ state, targetWorkUnitId: "WU-TARGET", input, timestamp: TS }),
    ).toThrowError(/circular|cycle/i);
  });

  it("reports zero completed work units/milestones modified and zero cycles introduced on success", () => {
    const state = stateWithTarget("ready");
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    expect(outcome.completedWorkUnitsModified).toBe(0);
    expect(outcome.completedMilestonesModified).toBe(0);
    expect(outcome.cyclesIntroduced).toBe(0);
  });

  it("leaves the done work unit WU-A completely unchanged", () => {
    const state = stateWithTarget("ready");
    const before = state.workGraph.workUnits.find((wu) => wu.id === "WU-A")!;
    const outcome = buildPlanRefinement({
      state,
      targetWorkUnitId: "WU-TARGET",
      input: validRefinementInput(),
      timestamp: TS,
    });
    const after = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU-A")!;
    expect(after).toEqual(before);
  });
});
