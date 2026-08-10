import { describe, it, expect } from "vitest";
import { checkNightAuditBudget, hasReachedTargetDuration, remainingReviewTaskBudget } from "../../src/workflow/night-audit-budget.js";
import type { NightAuditSessionBudget, NightAuditSessionUsage } from "../../src/schema/night-audit.schema.js";

const BUDGET: NightAuditSessionBudget = {
  targetDurationMinutes: 120,
  hardStopMinutes: 180,
  maxReviewTasks: 40,
  maxNewIssues: 10,
  maxOpenAuditIssueBacklog: 25,
};

function usage(overrides: Partial<NightAuditSessionUsage> = {}): NightAuditSessionUsage {
  return {
    elapsedMinutes: 0,
    reviewTasksAttempted: 0,
    reviewTasksCompleted: 0,
    newIssuesCreated: 0,
    consecutiveTasksWithNoAcceptedFindings: 0,
    ...overrides,
  };
}

describe("checkNightAuditBudget (build spec Sec 4, AND-of-limits)", () => {
  it("is not exhausted for zero usage", () => {
    expect(checkNightAuditBudget(BUDGET, usage())).toEqual({ exhausted: false, exceededDimensions: [] });
  });

  it("is exhausted when the hard stop is reached, independent of every other dimension", () => {
    const result = checkNightAuditBudget(BUDGET, usage({ elapsedMinutes: 180 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toContain("hardStopMinutes");
  });

  it("is exhausted when maxReviewTasks is reached", () => {
    const result = checkNightAuditBudget(BUDGET, usage({ reviewTasksAttempted: 40 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["maxReviewTasks"]);
  });

  it("is exhausted when maxNewIssues is reached", () => {
    const result = checkNightAuditBudget(BUDGET, usage({ newIssuesCreated: 10 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["maxNewIssues"]);
  });

  it("reports every exceeded dimension, not just the first", () => {
    const result = checkNightAuditBudget(BUDGET, usage({ elapsedMinutes: 200, reviewTasksAttempted: 50 }));
    expect(result.exceededDimensions.sort()).toEqual(["hardStopMinutes", "maxReviewTasks"]);
  });
});

describe("hasReachedTargetDuration", () => {
  it("is false below the soft target", () => {
    expect(hasReachedTargetDuration(BUDGET, usage({ elapsedMinutes: 119 }))).toBe(false);
  });

  it("is true at or above the soft target, even while under the hard stop", () => {
    expect(hasReachedTargetDuration(BUDGET, usage({ elapsedMinutes: 120 }))).toBe(true);
  });
});

describe("remainingReviewTaskBudget", () => {
  it("is the full budget at zero usage", () => {
    expect(remainingReviewTaskBudget(BUDGET, usage())).toBe(40);
  });

  it("decreases as tasks are attempted", () => {
    expect(remainingReviewTaskBudget(BUDGET, usage({ reviewTasksAttempted: 35 }))).toBe(5);
  });

  it("never goes negative", () => {
    expect(remainingReviewTaskBudget(BUDGET, usage({ reviewTasksAttempted: 50 }))).toBe(0);
  });
});
