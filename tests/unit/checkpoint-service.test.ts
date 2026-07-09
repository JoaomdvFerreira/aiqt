import { describe, it, expect } from "vitest";
import { applyCheckpoint } from "../../src/services/checkpoint-service.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import type { CheckpointInput } from "../../src/schema/checkpoint-input.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function wu(overrides: Partial<WorkUnit> = {}): WorkUnit {
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
    status: "in_progress",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "in_progress", workUnitIds: ["WU001"], ...overrides };
}

function stateWith(
  workUnits: WorkUnit[],
  milestones: Milestone[],
  dependencies: Dependency[] = [],
  overrides: Partial<StateModel> = {},
): StateModel {
  const state = buildInitialStateModel(T1);
  return {
    ...state,
    currentWorkUnitId: workUnits[0]?.id ?? null,
    workGraph: { milestones, workUnits, dependencies },
    lastAgentPacket: {
      id: "PKT-001",
      workUnitId: workUnits[0]?.id ?? "WU001",
      milestoneId: workUnits[0]?.milestoneId ?? "M001",
      createdAt: T1,
      format: "markdown",
      contentHash: "sha256:x",
      sourceCommand: "aiqt next",
    },
    ...overrides,
  };
}

function baseInput(overrides: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    summary: "Did the thing.",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [],
    acceptanceCriteria: [],
    issues: [],
    notes: [],
    ...overrides,
  };
}

describe("applyCheckpoint: done outcome", () => {
  it("builds a checkpoint record referencing the work unit and packet", () => {
    const state = stateWith([wu()], [milestone()]);
    const result = applyCheckpoint({
      state,
      workUnit: wu(),
      input: baseInput({ summary: "Finished it." }),
      checkpointId: "C001",
      timestamp: T2,
    });
    expect(result.checkpoint.id).toBe("C001");
    expect(result.checkpoint.workUnitId).toBe("WU001");
    expect(result.checkpoint.packetId).toBe("PKT-001");
    expect(result.checkpoint.summary).toBe("Finished it.");
    expect(result.checkpoint.finalWorkUnitStatus).toBe("done");
    expect(result.checkpoint.createdAt).toBe(T2);
  });

  it("clears currentWorkUnitId behavior is handled by the caller, but selects next ready + milestone", () => {
    const workUnits = [
      wu({ id: "WU001", status: "in_progress" }),
      wu({ id: "WU002", milestoneId: "M002", status: "ready" }),
    ];
    const milestones = [milestone({ id: "M001" }), milestone({ id: "M002", status: "ready", workUnitIds: ["WU002"] })];
    const state = stateWith(workUnits, milestones);
    const result = applyCheckpoint({
      state,
      workUnit: workUnits[0],
      input: baseInput(),
      checkpointId: "C001",
      timestamp: T2,
    });
    expect(result.nextReadyWorkUnitId).toBe("WU002");
    expect(result.currentMilestoneId).toBe("M002");
    expect(result.nextRecommendedCommand).toBe("aiqt next");
  });

  it("recommends aiqt review when done and no ready work exists", () => {
    const state = stateWith([wu()], [milestone()]);
    const result = applyCheckpoint({
      state,
      workUnit: wu(),
      input: baseInput(),
      checkpointId: "C001",
      timestamp: T2,
    });
    expect(result.nextRecommendedCommand).toBe("aiqt review");
    expect(result.currentMilestoneId).toBeNull();
    expect(result.projectStatus).toBe("review");
  });

  it("unlocks a downstream planned work unit via dependency recalculation", () => {
    const workUnits = [
      wu({ id: "WU001", status: "in_progress" }),
      wu({ id: "WU002", milestoneId: "M002", status: "planned" }),
    ];
    const dependencies: Dependency[] = [
      { id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null },
    ];
    const milestones = [milestone({ id: "M001" }), milestone({ id: "M002", status: "planned", workUnitIds: ["WU002"] })];
    const state = stateWith(workUnits, milestones, dependencies);
    const result = applyCheckpoint({
      state,
      workUnit: workUnits[0],
      input: baseInput(),
      checkpointId: "C001",
      timestamp: T2,
    });
    expect(result.newlyReadyWorkUnitIds).toEqual(["WU002"]);
    expect(result.workUnits.find((w) => w.id === "WU002")?.status).toBe("ready");
    expect(result.milestones.find((m) => m.id === "M002")?.status).toBe("ready");
    expect(result.nextReadyWorkUnitId).toBe("WU002");
  });
});

describe("applyCheckpoint: needs_review outcome", () => {
  it("sets currentMilestoneId to the checkpointed unit's milestone and recommends aiqt review", () => {
    const state = stateWith([wu()], [milestone()]);
    const result = applyCheckpoint({
      state,
      workUnit: wu(),
      input: baseInput({ validationResult: "failed" }),
      checkpointId: "C001",
      timestamp: T2,
    });
    expect(result.checkpoint.finalWorkUnitStatus).toBe("needs_review");
    expect(result.currentMilestoneId).toBe("M001");
    expect(result.nextRecommendedCommand).toBe("aiqt review");
    expect(result.projectStatus).toBe("review");
  });

  it("does not recalculate dependency readiness for needs_review", () => {
    const workUnits = [
      wu({ id: "WU001", status: "in_progress" }),
      wu({ id: "WU002", milestoneId: "M002", status: "planned" }),
    ];
    const dependencies: Dependency[] = [
      { id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null },
    ];
    const milestones = [milestone({ id: "M001" }), milestone({ id: "M002", status: "planned", workUnitIds: ["WU002"] })];
    const state = stateWith(workUnits, milestones, dependencies);
    const result = applyCheckpoint({
      state,
      workUnit: workUnits[0],
      input: baseInput({ validationResult: "failed" }),
      checkpointId: "C001",
      timestamp: T2,
    });
    expect(result.newlyReadyWorkUnitIds).toEqual([]);
    expect(result.workUnits.find((w) => w.id === "WU002")?.status).toBe("planned");
  });

  it("prioritizes aiqt review even when another unrelated ready work unit exists", () => {
    const workUnits = [
      wu({ id: "WU001", status: "in_progress" }),
      wu({ id: "WU002", milestoneId: "M002", status: "ready" }),
    ];
    const milestones = [milestone({ id: "M001" }), milestone({ id: "M002", status: "ready", workUnitIds: ["WU002"] })];
    const state = stateWith(workUnits, milestones);
    const result = applyCheckpoint({
      state,
      workUnit: workUnits[0],
      input: baseInput({ validationResult: "failed" }),
      checkpointId: "C001",
      timestamp: T2,
    });
    expect(result.checkpoint.finalWorkUnitStatus).toBe("needs_review");
    expect(result.nextRecommendedCommand).toBe("aiqt review");
  });
});

describe("applyCheckpoint: completion gate propagation", () => {
  it("throws AiqtError (exit 1) for an invalid done claim, before any state is touched", () => {
    const state = stateWith([wu()], [milestone()]);
    expect(() =>
      applyCheckpoint({
        state,
        workUnit: wu(),
        input: baseInput({ targetStatus: "done", validationResult: "failed" }),
        checkpointId: "C001",
        timestamp: T2,
      }),
    ).toThrow(AiqtError);
  });
});
