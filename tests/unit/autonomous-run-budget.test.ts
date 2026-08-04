import { describe, expect, it } from "vitest";
import type { AutonomousBudgets, AutonomousBudgetUsage } from "../../src/schema/autonomous-run.schema.js";
import { checkBudget, isApproachingBudget } from "../../src/workflow/autonomous-run-budget.js";

const BUDGETS: AutonomousBudgets = {
  maxWallClockSeconds: 1800,
  maxCommandCount: 100,
  maxRetryCount: 3,
  maxChangedFiles: 20,
  maxDiffLines: 500,
  maxValidationSeconds: 600,
};

function usage(overrides: Partial<AutonomousBudgetUsage> = {}): AutonomousBudgetUsage {
  return {
    wallClockSeconds: 0,
    commandCount: 0,
    retryCount: 0,
    changedFiles: 0,
    diffLines: 0,
    validationSeconds: 0,
    ...overrides,
  };
}

describe("M36-WU01: budget exhaustion is an AND-of-limits, any single dimension can exhaust it", () => {
  it("reports not exhausted when every dimension is within budget", () => {
    const result = checkBudget(BUDGETS, usage({ wallClockSeconds: 100, commandCount: 5 }));
    expect(result.exhausted).toBe(false);
    expect(result.exceededDimensions).toEqual([]);
  });

  it("reports exhausted when wall-clock alone exceeds its budget", () => {
    const result = checkBudget(BUDGETS, usage({ wallClockSeconds: 1801 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["wallClockSeconds"]);
  });

  it("reports exhausted when command count alone exceeds its budget", () => {
    const result = checkBudget(BUDGETS, usage({ commandCount: 101 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["commandCount"]);
  });

  it("reports exhausted when retry count alone exceeds its budget", () => {
    const result = checkBudget(BUDGETS, usage({ retryCount: 4 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["retryCount"]);
  });

  it("reports exhausted when changed-file count alone exceeds its budget", () => {
    const result = checkBudget(BUDGETS, usage({ changedFiles: 21 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["changedFiles"]);
  });

  it("reports exhausted when diff-line count alone exceeds its budget", () => {
    const result = checkBudget(BUDGETS, usage({ diffLines: 501 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["diffLines"]);
  });

  it("reports exhausted when validation duration alone exceeds its budget", () => {
    const result = checkBudget(BUDGETS, usage({ validationSeconds: 601 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["validationSeconds"]);
  });

  it("reports every exceeded dimension when multiple limits are exceeded simultaneously", () => {
    const result = checkBudget(BUDGETS, usage({ wallClockSeconds: 1801, commandCount: 101 }));
    expect(result.exhausted).toBe(true);
    expect(result.exceededDimensions).toEqual(["wallClockSeconds", "commandCount"]);
  });

  it("a value exactly at the limit is not exceeded (limits are inclusive ceilings)", () => {
    const result = checkBudget(BUDGETS, usage({ wallClockSeconds: 1800, commandCount: 100 }));
    expect(result.exhausted).toBe(false);
  });

  it("checks model-token spend only when both the budget and the usage define it", () => {
    const withTokenBudget: AutonomousBudgets = { ...BUDGETS, maxModelTokenSpend: 1000 };
    expect(checkBudget(withTokenBudget, usage({ modelTokenSpend: 1001 })).exhausted).toBe(true);
    expect(checkBudget(withTokenBudget, usage()).exhausted).toBe(false);
    expect(checkBudget(BUDGETS, usage({ modelTokenSpend: 999999 })).exhausted).toBe(false);
  });
});

describe("M36-WU01: budget-warning threshold", () => {
  it("reports no approaching dimensions well under the threshold", () => {
    expect(isApproachingBudget(BUDGETS, usage({ wallClockSeconds: 100 }))).toEqual([]);
  });

  it("reports a dimension approaching at 80% of its limit", () => {
    expect(isApproachingBudget(BUDGETS, usage({ wallClockSeconds: 1440 }))).toContain("wallClockSeconds");
  });

  it("does not report a dimension the exhaustion check would already flag as a warning duplicate concern -- both fire, by design", () => {
    const result = isApproachingBudget(BUDGETS, usage({ wallClockSeconds: 1801 }));
    expect(result).toContain("wallClockSeconds");
  });
});
