import { describe, it, expect } from "vitest";
import {
  computeEffectiveReadiness,
  computeEffectiveReadinessForState,
  findStaleReadyWorkUnits,
} from "../../src/workflow/effective-readiness.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

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

describe("computeEffectiveReadiness (M18 §6)", () => {
  it("is effectively ready when canonical status is ready and there is no incoming blocking dependency", () => {
    const wu = makeWorkUnit({ id: "WU001", milestoneId: "M001", status: "ready" });
    const state = baseState({ workGraph: { milestones: [], workUnits: [wu], dependencies: [] } });
    const result = computeEffectiveReadiness(wu, new Map([["WU001", wu]]), state.workGraph.dependencies);
    expect(result.effectivelyReady).toBe(true);
    expect(result.unsatisfiedDependencyIds).toEqual([]);
    expect(result.reasons).toEqual([]);
  });

  it("is NOT effectively ready when canonically ready but a blocks dependency source is not done (stale readiness)", () => {
    const source = makeWorkUnit({ id: "WU-SRC", milestoneId: "M001", status: "planned" });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const dep = makeDependency({ id: "DEP-1", fromId: "WU-SRC", toId: "WU-TGT", type: "blocks" });
    const byId = new Map([["WU-SRC", source], ["WU-TGT", target]]);
    const result = computeEffectiveReadiness(target, byId, [dep]);
    expect(result.effectivelyReady).toBe(false);
    expect(result.canonicalStatus).toBe("ready");
    expect(result.unsatisfiedDependencyIds).toEqual(["DEP-1"]);
    expect(result.blockingPredecessorWorkUnitIds).toEqual(["WU-SRC"]);
    expect(result.reasons).toContain("unsatisfied-blocking-dependency");
  });

  it("is NOT effectively ready when canonically ready but a requires dependency source is not done", () => {
    const source = makeWorkUnit({ id: "WU-SRC", milestoneId: "M001", status: "in_progress" });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const dep = makeDependency({ id: "DEP-1", fromId: "WU-SRC", toId: "WU-TGT", type: "requires" });
    const byId = new Map([["WU-SRC", source], ["WU-TGT", target]]);
    const result = computeEffectiveReadiness(target, byId, [dep]);
    expect(result.effectivelyReady).toBe(false);
  });

  it("is effectively ready when the blocking source is done", () => {
    const source = makeWorkUnit({ id: "WU-SRC", milestoneId: "M001", status: "done" });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const dep = makeDependency({ id: "DEP-1", fromId: "WU-SRC", toId: "WU-TGT", type: "blocks" });
    const byId = new Map([["WU-SRC", source], ["WU-TGT", target]]);
    const result = computeEffectiveReadiness(target, byId, [dep]);
    expect(result.effectivelyReady).toBe(true);
  });

  it("relates_to never affects readiness even when its source is not done", () => {
    const source = makeWorkUnit({ id: "WU-SRC", milestoneId: "M001", status: "planned" });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const dep = makeDependency({ id: "DEP-1", fromId: "WU-SRC", toId: "WU-TGT", type: "relates_to" });
    const byId = new Map([["WU-SRC", source], ["WU-TGT", target]]);
    const result = computeEffectiveReadiness(target, byId, [dep]);
    expect(result.effectivelyReady).toBe(true);
    expect(result.unsatisfiedDependencyIds).toEqual([]);
  });

  it("is not effectively ready when canonical status is not ready, regardless of dependencies", () => {
    const wu = makeWorkUnit({ id: "WU001", milestoneId: "M001", status: "planned" });
    const result = computeEffectiveReadiness(wu, new Map([["WU001", wu]]), []);
    expect(result.effectivelyReady).toBe(false);
    expect(result.reasons).toContain("canonical-status-not-ready");
  });

  it("a valid replanned predecessor with a correct boundary rewiring satisfies the dependency", () => {
    const replanned = makeWorkUnit({
      id: "WU-REPLANNED",
      milestoneId: "M001",
      status: "replanned",
      replanReason: "Detail further.",
      replacedByWorkUnitIds: ["WU-REPL"],
    });
    const replacement = makeWorkUnit({ id: "WU-REPL", milestoneId: "M001", status: "done" });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1", "DEP-2"] });
    const originalDep = makeDependency({ id: "DEP-1", fromId: "WU-REPLANNED", toId: "WU-TGT", type: "blocks" });
    const boundaryDep = makeDependency({ id: "DEP-2", fromId: "WU-REPL", toId: "WU-TGT", type: "blocks" });
    const byId = new Map([
      ["WU-REPLANNED", replanned],
      ["WU-REPL", replacement],
      ["WU-TGT", target],
    ]);
    const result = computeEffectiveReadiness(target, byId, [originalDep, boundaryDep]);
    expect(result.effectivelyReady).toBe(true);
  });

  it("a malformed replanned predecessor (empty replacedByWorkUnitIds) does NOT satisfy the dependency", () => {
    const replanned = makeWorkUnit({
      id: "WU-REPLANNED",
      milestoneId: "M001",
      status: "replanned",
      replanReason: "Detail further.",
      replacedByWorkUnitIds: [],
    });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const originalDep = makeDependency({ id: "DEP-1", fromId: "WU-REPLANNED", toId: "WU-TGT", type: "blocks" });
    const byId = new Map([["WU-REPLANNED", replanned], ["WU-TGT", target]]);
    const result = computeEffectiveReadiness(target, byId, [originalDep]);
    expect(result.effectivelyReady).toBe(false);
    expect(result.unsatisfiedDependencyIds).toEqual(["DEP-1"]);
  });

  it("a replanned predecessor missing boundary rewiring for this specific target does NOT satisfy the dependency", () => {
    // Metadata is well-formed (WU-REPL exists and is valid), but no
    // WU-REPL -> WU-TGT dependency was ever created -- the malformed
    // boundary-rewiring case (§7.3/§17.2).
    const replanned = makeWorkUnit({
      id: "WU-REPLANNED",
      milestoneId: "M001",
      status: "replanned",
      replanReason: "Detail further.",
      replacedByWorkUnitIds: ["WU-REPL"],
    });
    const replacement = makeWorkUnit({ id: "WU-REPL", milestoneId: "M001", status: "done" });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const originalDep = makeDependency({ id: "DEP-1", fromId: "WU-REPLANNED", toId: "WU-TGT", type: "blocks" });
    const byId = new Map([
      ["WU-REPLANNED", replanned],
      ["WU-REPL", replacement],
      ["WU-TGT", target],
    ]);
    const result = computeEffectiveReadiness(target, byId, [originalDep]);
    expect(result.effectivelyReady).toBe(false);
  });

  it("a replanned predecessor referencing an unknown replacement id does NOT satisfy the dependency", () => {
    const replanned = makeWorkUnit({
      id: "WU-REPLANNED",
      milestoneId: "M001",
      status: "replanned",
      replanReason: "Detail further.",
      replacedByWorkUnitIds: ["WU-DOES-NOT-EXIST"],
    });
    const target = makeWorkUnit({ id: "WU-TGT", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const originalDep = makeDependency({ id: "DEP-1", fromId: "WU-REPLANNED", toId: "WU-TGT", type: "blocks" });
    const byId = new Map([["WU-REPLANNED", replanned], ["WU-TGT", target]]);
    const result = computeEffectiveReadiness(target, byId, [originalDep]);
    expect(result.effectivelyReady).toBe(false);
  });
});

describe("findStaleReadyWorkUnits / computeEffectiveReadinessForState (M18 §5.3)", () => {
  it("returns only the canonically-ready-but-not-effectively-ready work units", () => {
    const wuA = makeWorkUnit({ id: "WU-A", milestoneId: "M001", status: "planned", dependencies: [] });
    const wuStale = makeWorkUnit({ id: "WU-STALE", milestoneId: "M001", status: "ready", dependencies: ["DEP-1"] });
    const wuGood = makeWorkUnit({ id: "WU-GOOD", milestoneId: "M001", status: "ready", dependencies: [] });
    const dep = makeDependency({ id: "DEP-1", fromId: "WU-A", toId: "WU-STALE", type: "blocks" });
    const state = baseState({
      workGraph: {
        milestones: [makeMilestone({ id: "M001", workUnitIds: ["WU-A", "WU-STALE", "WU-GOOD"] })],
        workUnits: [wuA, wuStale, wuGood],
        dependencies: [dep],
      },
    });
    const stale = findStaleReadyWorkUnits(state);
    expect(stale.map((r) => r.workUnitId)).toEqual(["WU-STALE"]);

    const all = computeEffectiveReadinessForState(state);
    expect(all.get("WU-GOOD")?.effectivelyReady).toBe(true);
    expect(all.get("WU-STALE")?.effectivelyReady).toBe(false);
    expect(all.get("WU-A")?.effectivelyReady).toBe(false); // canonically planned, not ready at all.
  });

  it("returns an empty list when the graph is fully normalized", () => {
    const wu = makeWorkUnit({ id: "WU001", milestoneId: "M001", status: "ready", dependencies: [] });
    const state = baseState({
      workGraph: {
        milestones: [makeMilestone({ id: "M001", workUnitIds: ["WU001"] })],
        workUnits: [wu],
        dependencies: [],
      },
    });
    expect(findStaleReadyWorkUnits(state)).toEqual([]);
  });

  it("supports legitimate parallel branches: two independent effectively-ready work units", () => {
    const wuA = makeWorkUnit({ id: "WU-A", milestoneId: "M001", status: "ready", dependencies: [] });
    const wuB = makeWorkUnit({ id: "WU-B", milestoneId: "M001", status: "ready", dependencies: [] });
    const state = baseState({
      workGraph: {
        milestones: [makeMilestone({ id: "M001", workUnitIds: ["WU-A", "WU-B"] })],
        workUnits: [wuA, wuB],
        dependencies: [],
      },
    });
    const all = computeEffectiveReadinessForState(state);
    expect(all.get("WU-A")?.effectivelyReady).toBe(true);
    expect(all.get("WU-B")?.effectivelyReady).toBe(true);
  });
});
