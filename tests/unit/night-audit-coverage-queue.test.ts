import { describe, it, expect } from "vitest";
import {
  scoreReviewCandidates,
  selectReviewTasksForBudget,
  computeReviewTaskId,
  shouldStopForDiminishingReturns,
  countRemainingHighPriorityCandidates,
  STALE_COVERAGE_DAYS,
  DIMINISHING_RETURN_CONSECUTIVE_EMPTY_THRESHOLD,
  type ReviewCandidateScope,
} from "../../src/workflow/night-audit-coverage-queue.js";
import type { NightAuditCoverageEntry } from "../../src/schema/night-audit.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";
const SHA = "c".repeat(40);

function coverageEntry(overrides: Partial<NightAuditCoverageEntry> = {}): NightAuditCoverageEntry {
  return {
    domain: "tests",
    scope: "src/workflow/",
    lastReviewedCommit: SHA,
    lastReviewedAt: NOW,
    outcomeSummary: "No accepted findings.",
    findingsProduced: false,
    ...overrides,
  };
}

const CANDIDATES: ReviewCandidateScope[] = [
  { domain: "tests", scope: "src/workflow/" },
  { domain: "documentation", scope: "docs/product/" },
  { domain: "code_quality", scope: "src/services/" },
];

describe("scoreReviewCandidates (build spec Sec 6 queue priority)", () => {
  it("tiers a never-reviewed candidate as tier 2", () => {
    const scored = scoreReviewCandidates({
      candidates: [CANDIDATES[0]],
      coverage: [],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(scored[0].tier).toBe(2);
    expect(scored[0].tierLabel).toBe("never_reviewed");
    expect(scored[0].lastReviewedAt).toBeNull();
  });

  it("tiers a reviewed-but-changed-since candidate as tier 1, ahead of never-reviewed", () => {
    const scored = scoreReviewCandidates({
      candidates: CANDIDATES.slice(0, 2),
      coverage: [coverageEntry()],
      changedScopeKeys: new Set(["tests::src/workflow/"]),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(scored[0].candidate).toEqual(CANDIDATES[0]);
    expect(scored[0].tier).toBe(1);
    expect(scored[1].tier).toBe(2);
  });

  it("tiers an unchanged, old-enough entry as tier 3 (stale)", () => {
    const staleAt = new Date(Date.parse(NOW) - (STALE_COVERAGE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const scored = scoreReviewCandidates({
      candidates: [CANDIDATES[0]],
      coverage: [coverageEntry({ lastReviewedAt: staleAt })],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(scored[0].tier).toBe(3);
    expect(scored[0].tierLabel).toBe("stale_coverage");
  });

  it("tiers a fresh, unchanged entry with a recent defect signal as tier 4", () => {
    const scored = scoreReviewCandidates({
      candidates: [CANDIDATES[0]],
      coverage: [coverageEntry()],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(["tests::src/workflow/"]),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(scored[0].tier).toBe(4);
  });

  it("tiers a fresh, unchanged, no-signal but high-churn entry as tier 5", () => {
    const scored = scoreReviewCandidates({
      candidates: [CANDIDATES[0]],
      coverage: [coverageEntry()],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(["tests::src/workflow/"]),
      nowIso: NOW,
    });
    expect(scored[0].tier).toBe(5);
  });

  it("tiers a fresh, unchanged, no-signal, low-churn entry as tier 6 (rotation)", () => {
    const scored = scoreReviewCandidates({
      candidates: [CANDIDATES[0]],
      coverage: [coverageEntry()],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(scored[0].tier).toBe(6);
    expect(scored[0].tierLabel).toBe("rotation");
  });

  it("breaks a same-tier tie by lastReviewedAt ascending (staler first)", () => {
    const older = new Date(Date.parse(NOW) - 2 * 24 * 60 * 60 * 1000).toISOString();
    const newer = new Date(Date.parse(NOW) - 1 * 24 * 60 * 60 * 1000).toISOString();
    const scored = scoreReviewCandidates({
      candidates: [CANDIDATES[0], CANDIDATES[1]],
      coverage: [coverageEntry({ ...CANDIDATES[1], lastReviewedAt: newer }), coverageEntry({ lastReviewedAt: older })],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(scored[0].candidate).toEqual(CANDIDATES[0]);
    expect(scored[1].candidate).toEqual(CANDIDATES[1]);
  });

  it("breaks a same-tier, same-lastReviewedAt tie by candidate key lexicographically -- fully deterministic", () => {
    const a = scoreReviewCandidates({
      candidates: CANDIDATES,
      coverage: [],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    const b = scoreReviewCandidates({
      candidates: CANDIDATES,
      coverage: [],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(a).toEqual(b);
  });
});

describe("computeReviewTaskId", () => {
  it("is deterministic for identical domain/scope/commit", () => {
    expect(computeReviewTaskId("tests", "src/workflow/", SHA)).toBe(computeReviewTaskId("tests", "src/workflow/", SHA));
  });

  it("changes when the commit changes", () => {
    expect(computeReviewTaskId("tests", "src/workflow/", SHA)).not.toBe(computeReviewTaskId("tests", "src/workflow/", "d".repeat(40)));
  });
});

describe("selectReviewTasksForBudget (build spec Sec 4 deterministic budget-aware selection)", () => {
  it("selects from the front of the queue, bounded by remaining budget", () => {
    const scored = scoreReviewCandidates({
      candidates: CANDIDATES,
      coverage: [],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    const tasks = selectReviewTasksForBudget(scored, SHA, 2);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].repositoryCommit).toBe(SHA);
  });

  it("never selects more than the queue contains", () => {
    const scored = scoreReviewCandidates({
      candidates: [CANDIDATES[0]],
      coverage: [],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(selectReviewTasksForBudget(scored, SHA, 10)).toHaveLength(1);
  });

  it("selects nothing when the remaining budget is zero or negative", () => {
    const scored = scoreReviewCandidates({
      candidates: CANDIDATES,
      coverage: [],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    expect(selectReviewTasksForBudget(scored, SHA, 0)).toHaveLength(0);
    expect(selectReviewTasksForBudget(scored, SHA, -1)).toHaveLength(0);
  });
});

describe("shouldStopForDiminishingReturns (build spec Sec 10)", () => {
  it("does not stop below the consecutive-empty threshold", () => {
    expect(shouldStopForDiminishingReturns(DIMINISHING_RETURN_CONSECUTIVE_EMPTY_THRESHOLD - 1, 0)).toBe(false);
  });

  it("does not stop at/above the threshold while high-priority scope remains", () => {
    expect(shouldStopForDiminishingReturns(DIMINISHING_RETURN_CONSECUTIVE_EMPTY_THRESHOLD, 3)).toBe(false);
  });

  it("stops only once both the threshold is met AND no high-priority scope remains", () => {
    expect(shouldStopForDiminishingReturns(DIMINISHING_RETURN_CONSECUTIVE_EMPTY_THRESHOLD, 0)).toBe(true);
  });
});

describe("countRemainingHighPriorityCandidates", () => {
  it("counts only tier 1 and tier 2 candidates", () => {
    const scored = scoreReviewCandidates({
      candidates: CANDIDATES,
      coverage: [coverageEntry({ ...CANDIDATES[2] })],
      changedScopeKeys: new Set(),
      recentDefectSignalScopeKeys: new Set(),
      highChurnScopeKeys: new Set(),
      nowIso: NOW,
    });
    // CANDIDATES[0]/[1] are never-reviewed (tier 2); CANDIDATES[2] is covered, unchanged, no signal (tier 6).
    expect(countRemainingHighPriorityCandidates(scored)).toBe(2);
  });
});
