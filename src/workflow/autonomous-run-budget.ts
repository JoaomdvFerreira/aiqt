import type { AutonomousBudgets, AutonomousBudgetUsage } from "../schema/autonomous-run.schema.js";

/**
 * M36-WU01: pure budget-exhaustion decision logic (build spec Sec 6.4).
 * Never starts a timer, never counts a real command -- WU36-03 is where
 * a real execution loop calls this with live usage figures. Every
 * dimension is checked independently; exceeding any single one is
 * sufficient to exhaust the budget (an AND-of-limits, not an average).
 */
export interface BudgetCheckResult {
  exhausted: boolean;
  exceededDimensions: string[];
}

export function checkBudget(budgets: AutonomousBudgets, usage: AutonomousBudgetUsage): BudgetCheckResult {
  const exceededDimensions: string[] = [];

  if (usage.wallClockSeconds > budgets.maxWallClockSeconds) exceededDimensions.push("wallClockSeconds");
  if (usage.commandCount > budgets.maxCommandCount) exceededDimensions.push("commandCount");
  if (usage.retryCount > budgets.maxRetryCount) exceededDimensions.push("retryCount");
  if (usage.changedFiles > budgets.maxChangedFiles) exceededDimensions.push("changedFiles");
  if (usage.diffLines > budgets.maxDiffLines) exceededDimensions.push("diffLines");
  if (usage.validationSeconds > budgets.maxValidationSeconds) exceededDimensions.push("validationSeconds");
  if (
    budgets.maxModelTokenSpend !== undefined &&
    usage.modelTokenSpend !== undefined &&
    usage.modelTokenSpend > budgets.maxModelTokenSpend
  ) {
    exceededDimensions.push("modelTokenSpend");
  }

  return { exhausted: exceededDimensions.length > 0, exceededDimensions };
}

/**
 * A warning threshold (build spec's `autonomous_run.budget_warning`
 * event) fires before exhaustion, at a fixed fraction of each limit --
 * gives an operator-facing signal that a run is approaching its ceiling
 * without yet being over it. 80% chosen as a conservative, round default
 * with no measured basis yet (no real execution loop exists to measure
 * against in this Work Unit); a future Work Unit may make this
 * configurable per budget dimension if real usage shows 80% is too
 * tight or too loose.
 */
const WARNING_FRACTION = 0.8;

export function isApproachingBudget(budgets: AutonomousBudgets, usage: AutonomousBudgetUsage): string[] {
  const approaching: string[] = [];
  if (usage.wallClockSeconds >= budgets.maxWallClockSeconds * WARNING_FRACTION) approaching.push("wallClockSeconds");
  if (usage.commandCount >= budgets.maxCommandCount * WARNING_FRACTION) approaching.push("commandCount");
  if (usage.changedFiles >= budgets.maxChangedFiles * WARNING_FRACTION) approaching.push("changedFiles");
  if (usage.diffLines >= budgets.maxDiffLines * WARNING_FRACTION) approaching.push("diffLines");
  return approaching;
}
