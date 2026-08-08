import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { resolve } from "node:path";
import { runStructuralReview } from "../../workflow/structural-review-engine.js";
import { consolidateFindings, suppressKnownBenignFindings } from "../../workflow/structural-review-consolidation.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "review", area: "structural-review", summary, exitCode, issueId });
}

/**
 * aiqt review structural explain <findingKey> [--json] (M43 §6.3/§7 WU43-03):
 * read-only. Findings are transient (Section 3.1) -- explain re-runs the
 * full review and locates the finding by key in the fresh result rather
 * than reading any stored record; a key that no longer appears (the
 * underlying condition was fixed, or never existed) is reported as not
 * found, not fabricated.
 */
export function runReviewStructuralExplain(ctx: CommandContext, findingKey: string): CommandResult {
  const raw = runStructuralReview({ repoRoot: resolve(ctx.cwd) });
  const consolidated = suppressKnownBenignFindings(consolidateFindings(raw.findings));
  const finding = consolidated.find((f) => f.findingKey === findingKey);

  if (!finding) {
    return failure(
      `No current structural finding with key "${findingKey}" (it may have been resolved, or never existed at the current review commit ${raw.reviewCommit}).`,
      ExitCode.InvalidInput,
      "REVIEW-STRUCTURAL-EXPLAIN-UNKNOWN-KEY",
    );
  }

  return makeResult({
    status: "passed",
    action: "review",
    projectStatus: null,
    currentMilestoneId: null,
    currentWorkUnitId: null,
    summary: `${finding.domain}/${finding.ruleId}: ${finding.title} [${finding.confidence}, ${finding.significance}, ${finding.disposition}, intake-eligible=${finding.eligibleForIntake}]`,
    exitCode: ExitCode.Success,
    data: { finding },
  });
}
