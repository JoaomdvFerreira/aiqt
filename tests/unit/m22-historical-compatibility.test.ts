import { describe, it, expect } from "vitest";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { IssueStateSchema } from "../../src/schema/issue-state.schema.js";
import { computeEffectiveReadinessForState } from "../../src/workflow/effective-readiness.js";
import { computeEffectiveCheckpointResult } from "../../src/services/checkpoint-amendment-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { Checkpoint, CheckpointIssue } from "../../src/schema/checkpoint.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { CheckpointAmendment } from "../../src/schema/checkpoint-amendment.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";

const historicalCheckpointIssue: CheckpointIssue = {
  title: "Legacy form error wrapper gap",
  description: "Predates M22",
  severity: "medium",
  status: "open",
  agentCanFix: true,
};

function historicalCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "C001",
    workUnitId: "WU001",
    packetId: null,
    summary: "Historical checkpoint",
    completed: ["did work"],
    notCompleted: [],
    filesChanged: ["src/a.ts"],
    issues: [historicalCheckpointIssue],
    validationResult: "passed",
    acceptanceCriteriaResult: "partial",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "needs_review",
    nextRecommendation: "aiqt review",
    createdAt: T1,
    ...overrides,
  };
}

const historicalAmendment: CheckpointAmendment = {
  amendmentId: "AMEND-001",
  checkpointId: "C001",
  workUnitId: "WU001",
  acceptanceCriteriaResult: "passed",
  reason: "Amended before M22 existed",
  amendedAt: T1,
  sourceCommand: "aiqt checkpoint amend",
};

function historicalWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
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
    status: "needs_review",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function historicalMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "in_progress", workUnitIds: ["WU001"], ...overrides };
}

/**
 * M22 governance micro-closure: a state shape representative of a project
 * that completed real work entirely before M22 -- real overrides,
 * promotions, a CheckpointIssue-bearing checkpoint, and a checkpoint
 * amendment -- but with no M22 fields (`issues.projectIssues`,
 * `issues.projectIssueTransitions`, `state.evidence`) present at all.
 */
function preM22StateWithRealHistoricalData(): StateModel {
  const base = buildInitialStateModel(T1);
  return {
    ...base,
    workGraph: { milestones: [historicalMilestone()], workUnits: [historicalWorkUnit()], dependencies: [] },
    checkpoints: [historicalCheckpoint()],
    checkpointAmendments: [historicalAmendment],
    issues: {
      overrides: [
        { issueKey: "checkpoint:WU001:issue:legacy-form-error-wrapper-gap", status: "accepted", reason: "r", updatedAt: T1, sourceCommand: "aiqt issue update" },
      ],
      promotions: [
        { issueKey: "checkpoint:WU002:issue:other", workUnitId: "WU010", milestoneId: "M001", promotedAt: T1, sourceCommand: "aiqt issue promote" },
      ],
      // projectIssues/projectIssueTransitions intentionally omitted.
    },
    // evidence intentionally omitted.
  };
}

describe("M22 governance micro-closure: explicit historical-compatibility gap closure", () => {
  it("state with real overrides+promotions but no M22 projectIssues/projectIssueTransitions fields parses via IssueStateSchema", () => {
    const issues = preM22StateWithRealHistoricalData().issues!;
    const parsed = IssueStateSchema.safeParse(issues);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.overrides).toHaveLength(1);
    expect(parsed.data.promotions).toHaveLength(1);
    expect(parsed.data.projectIssues).toBeUndefined();
    expect(parsed.data.projectIssueTransitions).toBeUndefined();
  });

  it("a full historical StateModel (real CheckpointIssue, real checkpoint amendment, real overrides/promotions, no M22 evidence/ProjectIssue fields) parses via StateModelSchema with no version-bump-driven rejection", () => {
    const state = preM22StateWithRealHistoricalData();
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.evidence).toBeUndefined();
    expect(parsed.data.issues?.projectIssues).toBeUndefined();
    expect(parsed.data.checkpoints[0].issues[0].title).toBe(historicalCheckpointIssue.title);
    expect(parsed.data.checkpointAmendments?.[0].amendmentId).toBe("AMEND-001");
  });

  it("effective-readiness computation over that same historical state is unaffected by the absent M22 fields", () => {
    const state = preM22StateWithRealHistoricalData();
    const readiness = computeEffectiveReadinessForState(state);
    const result = readiness.get("WU001");
    expect(result).toBeDefined();
    // WU001 has no dependencies and canonical status needs_review -- not
    // effectively ready (readiness only applies to "ready"), but the
    // computation itself must complete without error against this
    // historical shape.
    expect(result?.canonicalStatus).toBe("needs_review");
  });

  it("checkpoint-amendment effective-result computation over that same historical state is unaffected by the absent M22 fields", () => {
    const state = preM22StateWithRealHistoricalData();
    const effective = computeEffectiveCheckpointResult(state.checkpoints[0], state.checkpointAmendments ?? []);
    expect(effective.acceptanceCriteriaResult).toBe("passed"); // overridden by the amendment
    expect(effective.validationResult).toBe("passed"); // unchanged from the checkpoint itself
  });
});
