import { describe, it, expect } from "vitest";
import { resolveOrCreateProjectIssue, type ProjectIssueSeedFields } from "../../src/workflow/finding-routing.js";
import { findCheckpointIssueByKey } from "../../src/services/issue-service.js";
import { mintDecisionEscalationKey } from "../../src/workflow/finding-fingerprint.js";
import type { ProjectIssue } from "../../src/schema/project-issue.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { Checkpoint, CheckpointIssue } from "../../src/schema/checkpoint.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";

function seedFields(overrides: Partial<ProjectIssueSeedFields> = {}): ProjectIssueSeedFields {
  return {
    title: "t",
    description: "d",
    severity: "medium",
    sourceType: "evidence",
    sourceRefs: [],
    affectedWorkUnitIds: [],
    affectedMilestoneIds: [],
    evidenceIds: [],
    checkpointRefs: [],
    ownerRef: null,
    promotionRefs: [],
    ...overrides,
  };
}

describe("resolveOrCreateProjectIssue (WU23-06)", () => {
  it("creates a new ProjectIssue with no transition when no existing record matches", () => {
    const result = resolveOrCreateProjectIssue({
      issueKey: "evidence:execution_local:x",
      existingProjectIssues: [],
      nextProjectIssueId: "PI-001",
      timestamp: T1,
      projectIssueSeedFields: seedFields(),
    });
    expect(result.changed).toBe(true);
    expect(result.projectIssue.projectIssueId).toBe("PI-001");
    expect(result.projectIssue.issueKey).toBe("evidence:execution_local:x");
  });

  it("links to an existing ProjectIssue by issueKey instead of creating a duplicate", () => {
    const existing: ProjectIssue = {
      projectIssueId: "PI-001",
      issueKey: "evidence:execution_local:x",
      ...seedFields(),
      createdAt: T1,
      updatedAt: T1,
    };
    const result = resolveOrCreateProjectIssue({
      issueKey: "evidence:execution_local:x",
      existingProjectIssues: [existing],
      nextProjectIssueId: "PI-002",
      timestamp: T1,
      projectIssueSeedFields: seedFields(),
    });
    expect(result.changed).toBe(false);
    expect(result.projectIssue).toBe(existing);
  });
});

function checkpointIssue(overrides: Partial<CheckpointIssue> = {}): CheckpointIssue {
  return { title: "Some issue", description: null, severity: "medium", status: "open", agentCanFix: true, ...overrides };
}

function checkpoint(id: string, workUnitId: string, issues: CheckpointIssue[]): Checkpoint {
  return {
    id,
    workUnitId,
    packetId: null,
    summary: "s",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    issues,
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "done",
    nextRecommendation: "aiqt next",
    createdAt: T1,
  };
}

function stateWithCheckpoints(checkpoints: Checkpoint[]): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, checkpoints };
}

describe("findCheckpointIssueByKey (WU23-06)", () => {
  it("finds an open checkpoint issue by its recomputed canonical key", () => {
    const state = stateWithCheckpoints([checkpoint("CP001", "WU001", [checkpointIssue({ title: "Broken thing" })])]);
    const found = findCheckpointIssueByKey(state, "checkpoint:WU001:issue:broken-thing");
    expect(found?.checkpoint.id).toBe("CP001");
    expect(found?.issue.title).toBe("Broken thing");
  });

  it("returns undefined for a resolved (non-open) issue", () => {
    const state = stateWithCheckpoints([
      checkpoint("CP001", "WU001", [checkpointIssue({ title: "Fixed thing", status: "resolved" })]),
    ]);
    expect(findCheckpointIssueByKey(state, "checkpoint:WU001:issue:fixed-thing")).toBeUndefined();
  });

  it("returns undefined when no checkpoint issue matches the key", () => {
    const state = stateWithCheckpoints([]);
    expect(findCheckpointIssueByKey(state, "checkpoint:WU001:issue:nonexistent")).toBeUndefined();
  });

  it("disambiguates same-slug issues on the same work unit with the same occurrence-index scheme as buildNormalizedIssues", () => {
    const state = stateWithCheckpoints([
      checkpoint("CP001", "WU001", [checkpointIssue({ title: "Same issue" })]),
      checkpoint("CP002", "WU001", [checkpointIssue({ title: "Same issue" })]),
    ]);
    const first = findCheckpointIssueByKey(state, "checkpoint:WU001:issue:same-issue");
    const second = findCheckpointIssueByKey(state, "checkpoint:WU001:issue:same-issue-2");
    expect(first?.checkpoint.id).toBe("CP001");
    expect(second?.checkpoint.id).toBe("CP002");
  });
});

describe("mintDecisionEscalationKey (WU23-06)", () => {
  it("is deterministic and slugifies the question", () => {
    expect(mintDecisionEscalationKey("security", "Is this endpoint safe to expose?", 0)).toBe(
      "escalation:security:is-this-endpoint-safe-to-expose",
    );
  });

  it("disambiguates repeated slugs with a numeric suffix", () => {
    expect(mintDecisionEscalationKey("other", "Same question", 0)).toBe("escalation:other:same-question");
    expect(mintDecisionEscalationKey("other", "Same question", 1)).toBe("escalation:other:same-question-2");
  });

  it("produces different keys for different categories with the same question text", () => {
    expect(mintDecisionEscalationKey("security", "Q", 0)).not.toBe(mintDecisionEscalationKey("product", "Q", 0));
  });
});
