import type { AutonomousBudgets, AutonomousDiffSummary } from "../schema/autonomous-run.schema.js";
import type { AutonomousValidationResult } from "../services/autonomous-run-validation-service.js";

/**
 * M36-WU04 (build spec Sec 7 WU36-04 Scope: "self-review"; acceptance
 * criterion: "review findings are surfaced"; build spec Sec 6.6: "self-
 * review does not identify unresolved critical findings"). A pure
 * evaluator -- mirrors evidence-gate-simulation-engine.ts's (M28) "pure,
 * read-only" shape: consumes already-collected evidence, produces
 * findings and a verdict, performs no I/O of its own.
 */
export interface SelfReviewInput {
  diffSummary: AutonomousDiffSummary;
  validation: AutonomousValidationResult;
  budgets: AutonomousBudgets;
}

export interface SelfReviewResult {
  findings: string[];
  hasUnresolvedCriticalFindings: boolean;
}

/**
 * Every finding below is "critical" (there is no non-blocking finding
 * severity in this Work Unit's model -- build spec Sec 6.6 frames self-
 * review as a binary gate, "does not identify unresolved critical
 * findings," not a graded severity system). Order in the returned array
 * is deterministic (checks run in a fixed sequence), so two identical
 * inputs always produce an identically-ordered findings list.
 */
export function reviewAutonomousRun(input: SelfReviewInput): SelfReviewResult {
  const { diffSummary, validation, budgets } = input;
  const findings: string[] = [];

  if (!validation.targetedTestsPassed) {
    findings.push("Targeted validation did not pass (or no targeted validation command was ever supplied).");
  }
  if (validation.authoritativeValidationPassed === false) {
    findings.push("Authoritative validation was attempted and failed.");
  }
  if (validation.blockedReason) {
    findings.push(`Validation was blocked before completing: ${validation.blockedReason}`);
  }
  if (diffSummary.unexpectedFiles.length > 0) {
    findings.push(`Unexpected file(s) changed outside the declared repair scope: ${diffSummary.unexpectedFiles.join(", ")}.`);
  }
  if (diffSummary.changedFiles > budgets.maxChangedFiles) {
    findings.push(`Changed-file count (${diffSummary.changedFiles}) exceeds the run's budget (${budgets.maxChangedFiles}).`);
  }
  const totalDiffLines = diffSummary.insertedLines + diffSummary.deletedLines;
  if (totalDiffLines > budgets.maxDiffLines) {
    findings.push(`Diff size (${totalDiffLines} lines) exceeds the run's budget (${budgets.maxDiffLines}).`);
  }
  if (diffSummary.changedFiles === 0) {
    findings.push("No files were changed -- the repair attempt produced no diff.");
  }

  return { findings, hasUnresolvedCriticalFindings: findings.length > 0 };
}
