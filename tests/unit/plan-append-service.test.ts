import { describe, it, expect } from "vitest";
import { buildPlanAppend } from "../../src/services/plan-extension-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import type { PlanAppendInput } from "../../src/schema/plan-extension-input.schema.js";

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

/** A minimal existing graph: M-DONE (done, WU-DONE) -- M-OPEN (ready, WU-OPEN). */
function stateWithExistingGraph(): StateModel {
  const wuDone = makeWorkUnit({ id: "WU-DONE", milestoneId: "M-DONE", status: "done", dependencies: [] });
  const wuOpen = makeWorkUnit({ id: "WU-OPEN", milestoneId: "M-OPEN", status: "ready", dependencies: [] });
  return baseState({
    workGraph: {
      milestones: [
        makeMilestone({ id: "M-DONE", workUnitIds: ["WU-DONE"], status: "done" }),
        makeMilestone({ id: "M-OPEN", workUnitIds: ["WU-OPEN"], status: "ready" }),
      ],
      workUnits: [wuDone, wuOpen],
      dependencies: [],
    },
  });
}

function newWorkUnitInput(overrides: Partial<PlanAppendInput["workUnits"][number]> & { clientKey: string; milestoneClientKey: string }) {
  return {
    title: `New ${overrides.clientKey}`,
    objective: "New objective.",
    scope: ["Scope"],
    outOfScope: ["Out of scope"],
    acceptanceCriteria: ["Criterion"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    ...overrides,
  };
}

function emptyAppendInput(overrides: Partial<PlanAppendInput> = {}): PlanAppendInput {
  return { milestones: [], workUnits: [], dependencies: [], ...overrides };
}

describe("buildPlanAppend", () => {
  it("adds a new milestone with a new work unit under it", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      milestones: [{ clientKey: "new-m", title: "New Milestone", objective: "New milestone objective." }],
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "new-m" })],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    expect(outcome.addedMilestoneIds).toEqual(["M001"]);
    expect(outcome.addedWorkUnitIds).toEqual(["WU001"]);
    const milestone = outcome.state.workGraph.milestones.find((m) => m.id === "M001")!;
    expect(milestone.workUnitIds).toEqual(["WU001"]);
  });

  it("adds a new work unit under an existing milestone (referenced by canonical id)", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    expect(outcome.addedMilestoneIds).toEqual([]);
    expect(outcome.addedWorkUnitIds).toEqual(["WU001"]);
    const added = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU001")!;
    expect(added.milestoneId).toBe("M-OPEN");
    const milestone = outcome.state.workGraph.milestones.find((m) => m.id === "M-OPEN")!;
    expect(milestone.workUnitIds).toContain("WU001");
  });

  it("supports a dependency-only append wiring two existing work units together", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      dependencies: [{ fromClientKey: "WU-DONE", toClientKey: "WU-OPEN", type: "blocks" }],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    expect(outcome.addedMilestoneIds).toEqual([]);
    expect(outcome.addedWorkUnitIds).toEqual([]);
    expect(outcome.addedDependencyIds).toHaveLength(1);
    const dep = outcome.state.workGraph.dependencies.find((d) => d.id === outcome.addedDependencyIds[0])!;
    expect(dep.fromId).toBe("WU-DONE");
    expect(dep.toId).toBe("WU-OPEN");
  });

  it("wires a dependency from an existing work unit to a newly added work unit", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
      dependencies: [{ fromClientKey: "WU-OPEN", toClientKey: "new-wu", type: "blocks" }],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    const dep = outcome.state.workGraph.dependencies.find((d) => d.id === outcome.addedDependencyIds[0])!;
    expect(dep.fromId).toBe("WU-OPEN");
    expect(dep.toId).toBe(outcome.addedWorkUnitIds[0]);
  });

  it("wires a dependency from a newly added work unit to an existing work unit", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
      dependencies: [{ fromClientKey: "new-wu", toClientKey: "WU-OPEN", type: "blocks" }],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    const dep = outcome.state.workGraph.dependencies.find((d) => d.id === outcome.addedDependencyIds[0])!;
    expect(dep.fromId).toBe(outcome.addedWorkUnitIds[0]);
    expect(dep.toId).toBe("WU-OPEN");
  });

  it("wires a dependency between two newly added work units", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [
        newWorkUnitInput({ clientKey: "wu-a", milestoneClientKey: "M-OPEN" }),
        newWorkUnitInput({ clientKey: "wu-b", milestoneClientKey: "M-OPEN" }),
      ],
      dependencies: [{ fromClientKey: "wu-a", toClientKey: "wu-b", type: "blocks" }],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    const dep = outcome.state.workGraph.dependencies.find((d) => d.id === outcome.addedDependencyIds[0])!;
    expect(dep.fromId).toBe(outcome.addedWorkUnitIds[0]);
    expect(dep.toId).toBe(outcome.addedWorkUnitIds[1]);
  });

  it("rejects a duplicate milestone clientKey", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      milestones: [
        { clientKey: "dup", title: "A", objective: "A." },
        { clientKey: "dup", title: "B", objective: "B." },
      ],
      workUnits: [newWorkUnitInput({ clientKey: "wu-a", milestoneClientKey: "dup" })],
    });
    expect(() => buildPlanAppend({ state, input, timestamp: TS })).toThrowError(/duplicate/i);
  });

  it("rejects a duplicate work-unit clientKey", () => {
    const state = stateWithExistingGraph();
    const wu = newWorkUnitInput({ clientKey: "dup-wu", milestoneClientKey: "M-OPEN" });
    const input = emptyAppendInput({ workUnits: [wu, { ...wu }] });
    expect(() => buildPlanAppend({ state, input, timestamp: TS })).toThrowError(/duplicate/i);
  });

  it("rejects a work unit referencing an unknown milestone", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "wu-a", milestoneClientKey: "M-DOES-NOT-EXIST" })],
    });
    expect(() => buildPlanAppend({ state, input, timestamp: TS })).toThrowError(/unknown/i);
  });

  it("rejects a dependency referencing an unknown work unit", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      dependencies: [{ fromClientKey: "WU-OPEN", toClientKey: "WU-DOES-NOT-EXIST", type: "blocks" }],
    });
    expect(() => buildPlanAppend({ state, input, timestamp: TS })).toThrowError(/unknown/i);
  });

  it("rejects a cycle introduced by combining new dependencies with the existing graph", () => {
    const state = stateWithExistingGraph();
    state.workGraph.dependencies.push(
      makeDependency({ id: "DEP-EXIST", fromId: "WU-OPEN", toId: "WU-DONE", type: "blocks" }),
    );
    const input = emptyAppendInput({
      dependencies: [{ fromClientKey: "WU-DONE", toClientKey: "WU-OPEN", type: "blocks" }],
    });
    expect(() => buildPlanAppend({ state, input, timestamp: TS })).toThrowError(/circular|cycle/i);
  });

  it("rejects a work unit that depends on itself", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      dependencies: [{ fromClientKey: "WU-OPEN", toClientKey: "WU-OPEN", type: "blocks" }],
    });
    expect(() => buildPlanAppend({ state, input, timestamp: TS })).toThrowError(/itself/i);
  });

  it("never modifies the status of an existing work unit", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
      dependencies: [{ fromClientKey: "WU-OPEN", toClientKey: "new-wu", type: "blocks" }],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    const existingOpen = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU-OPEN")!;
    expect(existingOpen.status).toBe("ready");
    const existingDone = outcome.state.workGraph.workUnits.find((wu) => wu.id === "WU-DONE")!;
    expect(existingDone.status).toBe("done");
  });

  it("never modifies a completed milestone even when it gains a new child", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-DONE" })],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    const milestone = outcome.state.workGraph.milestones.find((m) => m.id === "M-DONE")!;
    expect(milestone.status).toBe("done");
  });

  it("never deletes an existing dependency", () => {
    const state = stateWithExistingGraph();
    state.workGraph.dependencies.push(
      makeDependency({ id: "DEP-EXIST", fromId: "WU-DONE", toId: "WU-OPEN", type: "blocks" }),
    );
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    expect(outcome.state.workGraph.dependencies.some((d) => d.id === "DEP-EXIST")).toBe(true);
  });

  it("assigns a new work unit 'ready' status when its only dependency source is already done", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
      dependencies: [{ fromClientKey: "WU-DONE", toClientKey: "new-wu", type: "blocks" }],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    const added = outcome.state.workGraph.workUnits.find((wu) => wu.id === outcome.addedWorkUnitIds[0])!;
    expect(added.status).toBe("ready");
  });

  it("assigns a new work unit 'planned' status when it depends on a not-yet-done existing work unit", () => {
    const state = stateWithExistingGraph();
    const notDone = makeWorkUnit({ id: "WU-PLANNED", milestoneId: "M-OPEN", status: "planned", dependencies: [] });
    state.workGraph.workUnits.push(notDone);
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
      dependencies: [{ fromClientKey: "WU-PLANNED", toClientKey: "new-wu", type: "blocks" }],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    const added = outcome.state.workGraph.workUnits.find((wu) => wu.id === outcome.addedWorkUnitIds[0])!;
    expect(added.status).toBe("planned");
  });

  it("reports zero completed work units/milestones modified and zero cycles introduced on success", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      workUnits: [newWorkUnitInput({ clientKey: "new-wu", milestoneClientKey: "M-OPEN" })],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    expect(outcome.completedWorkUnitsModified).toBe(0);
    expect(outcome.completedMilestonesModified).toBe(0);
    expect(outcome.cyclesIntroduced).toBe(0);
  });

  it("allocates deterministic sequential IDs continuing from the highest existing ID", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      milestones: [{ clientKey: "new-m", title: "New Milestone", objective: "New milestone objective." }],
      workUnits: [
        newWorkUnitInput({ clientKey: "wu-a", milestoneClientKey: "new-m" }),
        newWorkUnitInput({ clientKey: "wu-b", milestoneClientKey: "new-m" }),
      ],
    });
    const outcome = buildPlanAppend({ state, input, timestamp: TS });
    expect(outcome.addedMilestoneIds).toEqual(["M001"]);
    expect(outcome.addedWorkUnitIds).toEqual(["WU001", "WU002"]);
  });

  it("rejects an empty payload's implicit milestone-with-no-work-units", () => {
    const state = stateWithExistingGraph();
    const input = emptyAppendInput({
      milestones: [{ clientKey: "orphan-m", title: "Orphan", objective: "No children." }],
    });
    expect(() => buildPlanAppend({ state, input, timestamp: TS })).toThrowError(/no referencing/i);
  });
});
