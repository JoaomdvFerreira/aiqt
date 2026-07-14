import { describe, it, expect } from "vitest";
import {
  checkpointIssueKey,
  reviewIssueKey,
  effectiveIssueStatus,
  getIssueOverrides,
  getIssuePromotions,
  buildNormalizedIssues,
  isPromotable,
  findNormalizedIssue,
} from "../../src/services/issue-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ReviewResult } from "../../src/services/review-service.js";
import type { Checkpoint, CheckpointIssue } from "../../src/schema/checkpoint.schema.js";

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "review",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: { milestones: [], workUnits: [], dependencies: [] },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

function emptyReview(): ReviewResult {
  return {
    findings: [],
    findingCount: 0,
    blockingFindingCount: 0,
    warningFindingCount: 0,
    infoFindingCount: 0,
    recommendedExportTargets: [],
    nextRecommendedCommand: "aiqt review",
  };
}

function checkpointIssue(overrides: Partial<CheckpointIssue> = {}): CheckpointIssue {
  return {
    title: "Some issue",
    description: null,
    severity: "medium",
    status: "open",
    agentCanFix: true,
    ...overrides,
  };
}

function checkpoint(workUnitId: string, issues: CheckpointIssue[]): Checkpoint {
  return {
    id: "CP001",
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
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

describe("issue key contract", () => {
  it("checkpointIssueKey is deterministic and slugifies the title", () => {
    expect(checkpointIssueKey("WU013", "User profile role escalation", 0)).toBe(
      "checkpoint:WU013:issue:user-profile-role-escalation",
    );
  });

  it("checkpointIssueKey disambiguates repeated slugs on the same work unit with a numeric suffix", () => {
    expect(checkpointIssueKey("WU013", "Same issue", 0)).toBe("checkpoint:WU013:issue:same-issue");
    expect(checkpointIssueKey("WU013", "Same issue", 1)).toBe("checkpoint:WU013:issue:same-issue-2");
    expect(checkpointIssueKey("WU013", "Same issue", 2)).toBe("checkpoint:WU013:issue:same-issue-3");
  });

  it("reviewIssueKey reuses the finding key verbatim under a review: prefix", () => {
    expect(reviewIssueKey("checkpoint:WU003:acceptanceCriteriaResult:partial")).toBe(
      "review:checkpoint:WU003:acceptanceCriteriaResult:partial",
    );
  });
});

describe("getIssueOverrides / getIssuePromotions", () => {
  it("treats missing state.issues as empty arrays", () => {
    const state = baseState();
    expect(getIssueOverrides(state)).toEqual([]);
    expect(getIssuePromotions(state)).toEqual([]);
    expect(effectiveIssueStatus("checkpoint:WU001:issue:x", [])).toBe("active");
  });
});

describe("buildNormalizedIssues", () => {
  it("only includes open checkpoint issues, deterministically", () => {
    const state = baseState({
      checkpoints: [
        checkpoint("WU001", [
          checkpointIssue({ title: "Open one" }),
          checkpointIssue({ title: "Resolved one", status: "resolved" }),
        ]),
      ],
    });
    const issues = buildNormalizedIssues(state, emptyReview());
    expect(issues).toHaveLength(1);
    expect(issues[0].issueKey).toBe("checkpoint:WU001:issue:open-one");
    expect(issues[0].status).toBe("active");
  });

  it("only includes blocking review findings", () => {
    const review: ReviewResult = {
      ...emptyReview(),
      findings: [
        {
          id: "F1",
          findingKey: "checkpoint:WU003:acceptanceCriteriaResult:partial",
          category: "checkpoint",
          severity: "high",
          blocking: true,
          title: "Partial acceptance",
          message: "partial acceptance",
          relatedIds: ["WU003"],
          suggestedAction: "Review acceptance criteria.",
          nextRecommendedCommand: null,
        },
        {
          id: "F2",
          findingKey: "checkpoint:WU004:info:note",
          category: "checkpoint",
          severity: "info",
          blocking: false,
          title: "Informational",
          message: "informational",
          relatedIds: ["WU004"],
          suggestedAction: "None.",
          nextRecommendedCommand: null,
        },
      ],
    };
    const issues = buildNormalizedIssues(baseState(), review);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueKey).toBe("review:checkpoint:WU003:acceptanceCriteriaResult:partial");
    expect(issues[0].source).toBe("review");
  });

  it("resolves effective status and promotion links from state.issues", () => {
    const state = baseState({
      checkpoints: [checkpoint("WU013", [checkpointIssue({ title: "User profile role escalation", agentCanFix: false, severity: "high" })])],
      issues: {
        overrides: [
          {
            issueKey: "checkpoint:WU013:issue:user-profile-role-escalation",
            status: "deferred",
            reason: "Accepted as post-MVP security hardening.",
            updatedAt: "2026-07-14T00:00:00.000Z",
            sourceCommand: "aiqt issue update",
          },
        ],
        promotions: [],
      },
    });
    const issues = buildNormalizedIssues(state, emptyReview());
    expect(issues[0].status).toBe("deferred");
    expect(issues[0].promotedWorkUnitId).toBeNull();
  });
});

describe("isPromotable", () => {
  it("is false for resolved-status issues regardless of raw classification", () => {
    const issue = findNormalizedIssue(
      "checkpoint:WU001:issue:open-one",
      buildNormalizedIssues(
        baseState({
          checkpoints: [checkpoint("WU001", [checkpointIssue({ title: "Open one", agentCanFix: true })])],
          issues: {
            overrides: [
              {
                issueKey: "checkpoint:WU001:issue:open-one",
                status: "resolved",
                reason: "Fixed.",
                updatedAt: "2026-07-14T00:00:00.000Z",
                sourceCommand: "aiqt issue update",
              },
            ],
            promotions: [],
          },
        }),
        emptyReview(),
      ),
    )!;
    expect(isPromotable(issue)).toBe(false);
  });

  it("is true for an agent-fixable, non-resolved issue", () => {
    const issues = buildNormalizedIssues(
      baseState({
        checkpoints: [checkpoint("WU002", [checkpointIssue({ title: "Fixable", agentCanFix: true })])],
      }),
      emptyReview(),
    );
    expect(isPromotable(issues[0])).toBe(true);
  });
});
