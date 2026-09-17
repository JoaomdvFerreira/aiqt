import { describe, it, expect } from "vitest";
import {
  computeEffectiveCheckpointResult,
  applyCheckpointAmendment,
  getCheckpointAmendments,
  latestCheckpointForWorkUnit,
} from "../../src/services/checkpoint-amendment-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../../src/schema/work-unit.schema.js";
import type { CheckpointAmendment } from "../../src/schema/checkpoint-amendment.schema.js";

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "C001",
    workUnitId: "WU001",
    packetId: null,
    summary: "s",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    issues: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "partial",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "needs_review",
    nextRecommendation: "aiqt review",
    createdAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

function workUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "Unit",
    objective: "obj",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: [],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: [],
    status: "needs_review" as WorkUnitStatus,
    dependencies: [],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

function amendment(overrides: Partial<CheckpointAmendment> = {}): CheckpointAmendment {
  return {
    amendmentId: "AMEND-001",
    checkpointId: "C001",
    workUnitId: "WU001",
    reason: "reason",
    amendedAt: "2026-07-14T00:00:00.000Z",
    sourceCommand: "aiqt checkpoint amend",
    ...overrides,
  };
}

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "review",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: {
      milestones: [
        { id: "M001", title: "M", objective: "o", status: "in_progress", workUnitIds: ["WU001"] },
      ],
      workUnits: [workUnit()],
      dependencies: [],
    },
    checkpoints: [checkpoint()],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("getCheckpointAmendments", () => {
  it("treats missing state.checkpointAmendments as an empty array", () => {
    expect(getCheckpointAmendments(baseState())).toEqual([]);
  });
});

describe("computeEffectiveCheckpointResult", () => {
  it("returns the original checkpoint result when no amendments exist", () => {
    const cp = checkpoint({ acceptanceCriteriaResult: "partial", validationResult: "passed" });
    expect(computeEffectiveCheckpointResult(cp, [])).toEqual({
      acceptanceCriteriaResult: "partial",
      validationResult: "passed",
      notCompleted: [],
    });
  });

  it("uses the latest amendment (by stored order) for a field over the original result", () => {
    const cp = checkpoint({ acceptanceCriteriaResult: "partial" });
    const amendments = [
      amendment({ amendmentId: "AMEND-001", acceptanceCriteriaResult: "failed" }),
      amendment({ amendmentId: "AMEND-002", acceptanceCriteriaResult: "passed" }),
    ];
    expect(computeEffectiveCheckpointResult(cp, amendments).acceptanceCriteriaResult).toBe("passed");
  });

  it("leaves a field at the original value when no amendment ever sets it", () => {
    const cp = checkpoint({ validationResult: "passed", acceptanceCriteriaResult: "partial" });
    const amendments = [amendment({ acceptanceCriteriaResult: "passed" })];
    const effective = computeEffectiveCheckpointResult(cp, amendments);
    expect(effective.validationResult).toBe("passed");
    expect(effective.acceptanceCriteriaResult).toBe("passed");
  });

  it("ignores amendments for a different checkpointId", () => {
    const cp = checkpoint({ id: "C001", acceptanceCriteriaResult: "partial" });
    const amendments = [amendment({ checkpointId: "C999", acceptanceCriteriaResult: "passed" })];
    expect(computeEffectiveCheckpointResult(cp, amendments).acceptanceCriteriaResult).toBe("partial");
  });
});

describe("latestCheckpointForWorkUnit", () => {
  it("returns the last stored checkpoint for a work unit", () => {
    const state = baseState({
      checkpoints: [
        checkpoint({ id: "C001" }),
        checkpoint({ id: "C002" }),
      ],
    });
    expect(latestCheckpointForWorkUnit(state, "WU001")?.id).toBe("C002");
  });

  it("returns undefined when the work unit has no checkpoints", () => {
    const state = baseState({ checkpoints: [] });
    expect(latestCheckpointForWorkUnit(state, "WU001")).toBeUndefined();
  });
});

describe("applyCheckpointAmendment: done work units", () => {
  it("changes effective findings but never reopens or demotes a done work unit", () => {
    const state = baseState({
      workGraph: {
        milestones: [
          { id: "M001", title: "M", objective: "o", status: "done", workUnitIds: ["WU001"] },
        ],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
      checkpoints: [checkpoint({ acceptanceCriteriaResult: "partial", finalWorkUnitStatus: "done" })],
    });

    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      amendmentId: "AMEND-001",
      reason: "Accepted as user-action-required limitation.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.changed).toBe(true);
    expect(result.workUnitStatusBefore).toBe("done");
    expect(result.workUnitStatusAfter).toBe("done");
    expect(result.effectiveAcceptanceCriteriaResult).toBe("passed");
    expect(result.workUnits.find((w) => w.id === "WU001")?.status).toBe("done");
  });
});

describe("applyCheckpointAmendment: needs_review -> done completion gate", () => {
  it("transitions to done when both effective results become passed on the latest checkpoint", () => {
    const state = baseState();
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      amendmentId: "AMEND-001",
      reason: "Live verification accepted.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.changed).toBe(true);
    expect(result.workUnitStatusBefore).toBe("needs_review");
    expect(result.workUnitStatusAfter).toBe("done");
    expect(result.workUnits.find((w) => w.id === "WU001")?.status).toBe("done");
  });

  it("does not transition when only one of validation/acceptance becomes passed", () => {
    const state = baseState({
      checkpoints: [checkpoint({ validationResult: "partial", acceptanceCriteriaResult: "partial" })],
    });
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      amendmentId: "AMEND-001",
      reason: "Partial acceptance fix only.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.workUnitStatusAfter).toBe("needs_review");
  });

  it("does not transition when the amended checkpoint is not the latest for the work unit", () => {
    const state = baseState({
      checkpoints: [
        checkpoint({ id: "C001", acceptanceCriteriaResult: "partial" }),
        checkpoint({ id: "C002", acceptanceCriteriaResult: "partial" }),
      ],
    });
    const staleCheckpoint = state.checkpoints[0]; // C001, not the latest (C002 is)
    const result = applyCheckpointAmendment({
      state,
      checkpoint: staleCheckpoint,
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      amendmentId: "AMEND-001",
      reason: "Amending a stale checkpoint.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.workUnitStatusAfter).toBe("needs_review");
  });

  it("does not transition when currentWorkUnitId still points at this same work unit", () => {
    const state = baseState({ currentWorkUnitId: "WU001" });
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      amendmentId: "AMEND-001",
      reason: "Should not promote while active.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.workUnitStatusAfter).toBe("needs_review");
  });

  it("uses the same completion predicate and cannot hide unfinished work", () => {
    const state = baseState({
      checkpoints: [checkpoint({ notCompleted: ["remaining work"] })],
    });
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      amendmentId: "AMEND-001",
      reason: "Aggregate correction.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });
    expect(result.workUnitStatusAfter).toBe("needs_review");
  });

  it("promotes only after a recorded unfinished-work item is reconciled", () => {
    const state = baseState({
      checkpoints: [checkpoint({ notCompleted: ["External review follow-up"] })],
    });
    const originalNotCompleted = [...state.checkpoints[0].notCompleted];
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      resolvedNotCompleted: "External review follow-up",
      resolutionEvidenceReference: "review:PR-123",
      amendmentId: "AMEND-001",
      reason: "External review confirmed the follow-up is complete.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.workUnitStatusAfter).toBe("done");
    expect(result.amendment).toMatchObject({
      resolvedNotCompleted: "External review follow-up",
      resolutionEvidenceReference: "review:PR-123",
    });
    expect(state.checkpoints[0].notCompleted).toEqual(originalNotCompleted);
  });

  it("keeps partial unfinished-work reconciliation blocked", () => {
    const state = baseState({
      checkpoints: [checkpoint({ notCompleted: ["one", "two"] })],
    });
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      resolvedNotCompleted: "one",
      amendmentId: "AMEND-001",
      reason: "Only one item was confirmed.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.workUnitStatusAfter).toBe("needs_review");
  });

  it("cannot hide an unresolved blocker or detailed required failure", () => {
    const state = baseState({
      workGraph: { ...baseState().workGraph, workUnits: [workUnit({ validationCommands: ["pnpm test"] })] },
      checkpoints: [checkpoint({
        issues: [{ title: "blocker", description: null, severity: "high", status: "open", agentCanFix: true }],
        validationCommands: [{ command: "pnpm test", result: "failed", summary: null }],
      })],
    });
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      amendmentId: "AMEND-001",
      reason: "Aggregate correction.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });
    expect(result.workUnitStatusAfter).toBe("needs_review");
  });
});

describe("applyCheckpointAmendment: idempotency", () => {
  it("is a no-op when the requested value already matches the effective result", () => {
    const state = baseState({
      checkpointAmendments: [amendment({ acceptanceCriteriaResult: "passed" })],
    });
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      acceptanceCriteriaResult: "passed",
      amendmentId: "AMEND-002",
      reason: "Re-applying the same value.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.changed).toBe(false);
    expect(result.amendment).toBeNull();
  });

  it("is a no-op when an unfinished-work item was already reconciled", () => {
    const state = baseState({
      checkpoints: [checkpoint({ notCompleted: ["review follow-up"] })],
      checkpointAmendments: [amendment({ resolvedNotCompleted: "review follow-up" })],
    });
    const result = applyCheckpointAmendment({
      state,
      checkpoint: state.checkpoints[0],
      workUnit: state.workGraph.workUnits[0],
      resolvedNotCompleted: "review follow-up",
      amendmentId: "AMEND-002",
      reason: "Retry.",
      timestamp: "2026-07-14T01:00:00.000Z",
    });

    expect(result.changed).toBe(false);
    expect(result.amendment).toBeNull();
  });
});
