import { describe, it, expect } from "vitest";
import {
  NightReviewDomainSchema,
  NightAuditSessionBudgetSchema,
  NightAuditSessionUsageSchema,
  NightAuditActiveSessionRecordSchema,
  NightAuditCoverageEntrySchema,
  ReviewTaskSchema,
  AuditFindingSchema,
  NightAuditResultSchema,
} from "../../src/schema/night-audit.schema.js";
import { DefectRecordSchema, DefectExternalIssueRefSchema } from "../../src/schema/defect.schema.js";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const NOW = "2026-08-10T00:00:00.000Z";
const SHA = "a".repeat(40);
const DIGEST = "sha256:" + "b".repeat(64);

function buildBudget(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    targetDurationMinutes: 120,
    hardStopMinutes: 180,
    maxReviewTasks: 40,
    maxNewIssues: 10,
    maxOpenAuditIssueBacklog: 25,
    ...overrides,
  };
}

function buildUsage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    elapsedMinutes: 0,
    reviewTasksAttempted: 0,
    reviewTasksCompleted: 0,
    newIssuesCreated: 0,
    consecutiveTasksWithNoAcceptedFindings: 0,
    ...overrides,
  };
}

describe("NightReviewDomainSchema (build spec Sec 5)", () => {
  it("accepts exactly the six named domains", () => {
    for (const domain of ["code_quality", "tests", "documentation", "repository_structure", "architecture", "governance_config"]) {
      expect(NightReviewDomainSchema.safeParse(domain).success).toBe(true);
    }
  });

  it("rejects an unlisted domain -- no domain is invented merely to increase coverage", () => {
    expect(NightReviewDomainSchema.safeParse("security").success).toBe(false);
  });
});

describe("NightAuditSessionBudgetSchema (build spec Sec 4)", () => {
  it("round-trips a valid budget", () => {
    expect(NightAuditSessionBudgetSchema.safeParse(buildBudget()).success).toBe(true);
  });

  it("rejects hardStopMinutes below targetDurationMinutes -- the ceiling can never be tighter than the soft target", () => {
    const result = NightAuditSessionBudgetSchema.safeParse(buildBudget({ targetDurationMinutes: 180, hardStopMinutes: 120 }));
    expect(result.success).toBe(false);
  });

  it("accepts hardStopMinutes equal to targetDurationMinutes", () => {
    expect(NightAuditSessionBudgetSchema.safeParse(buildBudget({ targetDurationMinutes: 120, hardStopMinutes: 120 })).success).toBe(true);
  });

  it("does not hard-code a product-policy default -- every field is required", () => {
    expect(NightAuditSessionBudgetSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(NightAuditSessionBudgetSchema.safeParse({ ...buildBudget(), extra: "nope" }).success).toBe(false);
  });
});

describe("NightAuditSessionUsageSchema", () => {
  it("round-trips valid usage", () => {
    expect(NightAuditSessionUsageSchema.safeParse(buildUsage()).success).toBe(true);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(NightAuditSessionUsageSchema.safeParse({ ...buildUsage(), extra: 1 }).success).toBe(false);
  });
});

describe("NightAuditActiveSessionRecordSchema (build spec Sec 9 resumability anchor)", () => {
  it("round-trips a minimal active session record", () => {
    const parsed = NightAuditActiveSessionRecordSchema.safeParse({
      sessionId: "session-001",
      startedAt: NOW,
      budget: buildBudget(),
      usage: buildUsage(),
      portfolioRef: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a portfolio-selected target reference", () => {
    const parsed = NightAuditActiveSessionRecordSchema.safeParse({
      sessionId: "session-001",
      startedAt: NOW,
      budget: buildBudget(),
      usage: buildUsage(),
      portfolioRef: { portfolioId: "PORT-001", memberId: "MEM-001" },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("NightAuditCoverageEntrySchema (build spec Sec 6)", () => {
  it("round-trips a minimal coverage entry", () => {
    const parsed = NightAuditCoverageEntrySchema.safeParse({
      domain: "tests",
      scope: "src/workflow/",
      lastReviewedCommit: SHA,
      lastReviewedAt: NOW,
      outcomeSummary: "No accepted findings.",
      findingsProduced: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const raw = {
      domain: "tests",
      scope: "src/workflow/",
      lastReviewedCommit: SHA,
      lastReviewedAt: NOW,
      outcomeSummary: "x",
      findingsProduced: false,
      extra: "nope",
    };
    expect(NightAuditCoverageEntrySchema.safeParse(raw).success).toBe(false);
  });
});

describe("ReviewTaskSchema (build spec Sec 5)", () => {
  it("round-trips a minimal review task", () => {
    const parsed = ReviewTaskSchema.safeParse({
      taskId: "task-001",
      domain: "documentation",
      scope: "docs/product/",
      repositoryCommit: SHA,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("AuditFindingSchema (build spec Sec 7/8)", () => {
  function buildFinding(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      findingKey: DIGEST,
      domain: "code_quality",
      checkId: "duplicate-logic",
      title: "Duplicate retry logic",
      explanation: "Two modules independently implement the same retry loop.",
      reviewCommit: SHA,
      scope: "src/services/",
      affectedPaths: ["src/services/a.ts", "src/services/b.ts"],
      evidence: [{ evidenceId: "ev-1", description: "Identical loop body", locator: "src/services/a.ts:10-20" }],
      confidence: "strong_signal",
      significance: "medium",
      disposition: "actionable",
      recommendedNextAction: "Extract a shared helper.",
      ...overrides,
    };
  }

  it("round-trips a minimal valid finding", () => {
    expect(AuditFindingSchema.safeParse(buildFinding()).success).toBe(true);
  });

  it("requires at least one evidence item", () => {
    expect(AuditFindingSchema.safeParse(buildFinding({ evidence: [] })).success).toBe(false);
  });

  it("rejects a findingKey not shaped like a sha256 digest", () => {
    expect(AuditFindingSchema.safeParse(buildFinding({ findingKey: "not-a-digest" })).success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(AuditFindingSchema.safeParse({ ...buildFinding(), extra: "nope" }).success).toBe(false);
  });
});

describe("NightAuditResultSchema (build spec Sec 14)", () => {
  it("round-trips a minimal result", () => {
    const parsed = NightAuditResultSchema.safeParse({
      sessionId: "session-001",
      startedAt: NOW,
      finishedAt: NOW,
      stopReason: "queue_exhausted",
      tasksAttempted: 3,
      tasksCompleted: 3,
      domainsReviewed: ["tests", "documentation"],
      candidateFindings: 1,
      acceptedFindings: 1,
      rejectedFindings: 0,
      duplicatesSuppressed: { byFingerprint: 0, byExistingIssueRef: 0, byGithubSearch: 0 },
      newIssuesCreated: [{ number: 42, url: "https://github.com/example/repo/issues/42" }],
      issuePublicationSuppressed: false,
      currentAuditIssueBacklog: 1,
      budgetRemaining: buildUsage({ reviewTasksAttempted: 3, reviewTasksCompleted: 3, newIssuesCreated: 1 }),
      unreviewedHighPriorityScope: [],
      ambiguousReconciliationsNeeded: [],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("DefectRecord.externalIssueRef (build spec Sec 6/7 -- M42 remains sole defect authority)", () => {
  it("DefectExternalIssueRefSchema round-trips a github issue reference", () => {
    expect(
      DefectExternalIssueRefSchema.safeParse({
        provider: "github",
        number: 7,
        url: "https://github.com/example/repo/issues/7",
        publishedAt: NOW,
      }).success,
    ).toBe(true);
  });

  it("DefectRecordSchema accepts an optional externalIssueRef", () => {
    const record = {
      defectId: "DEF-001",
      title: "Example",
      summary: "Example summary",
      sourceKind: "review_finding",
      evidenceRefs: [{ evidenceRefId: "ev-1", sourceKind: "review_finding", locator: "src/x.ts:1", capturedAt: NOW }],
      fingerprint: DIGEST,
      severity: "medium",
      confidence: "probable",
      status: "candidate",
      freshness: { state: "current", evaluatedAt: NOW },
      externalIssueRef: { provider: "github", number: 7, url: "https://github.com/example/repo/issues/7", publishedAt: NOW },
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(DefectRecordSchema.safeParse(record).success).toBe(true);
  });

  it("DefectRecordSchema still validates with externalIssueRef entirely absent (pre-M48 defects)", () => {
    const record = {
      defectId: "DEF-001",
      title: "Example",
      summary: "Example summary",
      sourceKind: "human_reported",
      evidenceRefs: [{ evidenceRefId: "ev-1", sourceKind: "human_reported", locator: "src/x.ts:1", capturedAt: NOW }],
      fingerprint: DIGEST,
      severity: "medium",
      confidence: "probable",
      status: "candidate",
      freshness: { state: "current", evaluatedAt: NOW },
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(DefectRecordSchema.safeParse(record).success).toBe(true);
  });
});

describe("StateModel.nightAuditCoverage / nightAuditActiveSession (M48 additive canonical section)", () => {
  it("is absent on a freshly built initial state model and still validates", () => {
    const model = buildInitialStateModel(NOW);
    expect((model as Record<string, unknown>).nightAuditCoverage).toBeUndefined();
    expect((model as Record<string, unknown>).nightAuditActiveSession).toBeUndefined();
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });

  it("validates when nightAuditCoverage is present and populated, and nightAuditActiveSession is null", () => {
    const model = {
      ...buildInitialStateModel(NOW),
      nightAuditCoverage: [
        { domain: "tests", scope: "src/", lastReviewedCommit: SHA, lastReviewedAt: NOW, outcomeSummary: "clean", findingsProduced: false },
      ],
      nightAuditActiveSession: null,
    };
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });

  it("validates when nightAuditActiveSession is a populated record", () => {
    const model = {
      ...buildInitialStateModel(NOW),
      nightAuditActiveSession: {
        sessionId: "session-001",
        startedAt: NOW,
        budget: buildBudget(),
        usage: buildUsage(),
        portfolioRef: null,
      },
    };
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });

  it("pre-M48 state (no night-audit keys at all) still parses -- compatibility", () => {
    const model = buildInitialStateModel(NOW) as Record<string, unknown>;
    delete model.nightAuditCoverage;
    delete model.nightAuditActiveSession;
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });

  it("no coverage entry is ever created by migration/defaulting -- initial state model never carries a populated coverage array", () => {
    const model = buildInitialStateModel(NOW);
    expect((model as Record<string, unknown>).nightAuditCoverage).toBeUndefined();
  });
});
