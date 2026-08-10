import type { NightAuditSessionBudget, NightAuditSessionUsage } from "../schema/night-audit.schema.js";

/**
 * M48-WU02 (build spec Sec 4): pure budget-exhaustion decision logic,
 * mirroring autonomous-run-budget.ts's independent-dimension (AND-of-limits)
 * discipline -- exceeding any single dimension is sufficient, never an
 * average. Never starts a timer, never counts a real task -- the session
 * service (WU48-05) calls this with live usage figures.
 */

export interface NightAuditBudgetCheckResult {
  exhausted: boolean;
  exceededDimensions: string[];
}

/** Build spec Sec 4: the hard, unconditional ceiling -- reached regardless of remaining queue. */
export function checkNightAuditBudget(budget: NightAuditSessionBudget, usage: NightAuditSessionUsage): NightAuditBudgetCheckResult {
  const exceededDimensions: string[] = [];
  if (usage.elapsedMinutes >= budget.hardStopMinutes) exceededDimensions.push("hardStopMinutes");
  if (usage.reviewTasksAttempted >= budget.maxReviewTasks) exceededDimensions.push("maxReviewTasks");
  if (usage.newIssuesCreated >= budget.maxNewIssues) exceededDimensions.push("maxNewIssues");
  return { exhausted: exceededDimensions.length > 0, exceededDimensions };
}

/** Build spec Sec 4: the soft target -- a session may finish early once this elapses and no priority-due scope remains, but reaching it alone never force-stops a session still doing useful work. */
export function hasReachedTargetDuration(budget: NightAuditSessionBudget, usage: NightAuditSessionUsage): boolean {
  return usage.elapsedMinutes >= budget.targetDurationMinutes;
}

/** Build spec Sec 4: remaining task budget for the current selection pass -- never negative. */
export function remainingReviewTaskBudget(budget: NightAuditSessionBudget, usage: NightAuditSessionUsage): number {
  return Math.max(0, budget.maxReviewTasks - usage.reviewTasksAttempted);
}
