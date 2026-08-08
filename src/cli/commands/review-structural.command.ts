import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { resolve } from "node:path";
import { runStructuralReview } from "../../workflow/structural-review-engine.js";
import { consolidateFindings, suppressKnownBenignFindings } from "../../workflow/structural-review-consolidation.js";
import { isKnownStructuralDomain } from "../../workflow/structural-review-domains.js";
import type { StructuralReview } from "../../schema/structural-review.schema.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "review", area: "structural-review", summary, exitCode, issueId });
}

export interface RunReviewStructuralOptions {
  domain?: string;
}

/**
 * aiqt review structural [--domain <domain>] [--json] (M43 §7/§10 WU43-03):
 * bounded, read-only, offline-capable structural review. Never mutates
 * canonical state or appends a runlog event (Section 3.1) -- this
 * command has no project/state dependency at all, unlike `aiqt review`'s
 * bare mode. Does not touch or replace existing `aiqt review --mode`
 * development/release semantics.
 */
export function runReviewStructural(ctx: CommandContext, options: RunReviewStructuralOptions): CommandResult {
  if (options.domain && !isKnownStructuralDomain(options.domain)) {
    return failure(
      `Unrecognized structural review domain "${options.domain}".`,
      ExitCode.InvalidInput,
      "REVIEW-STRUCTURAL-UNKNOWN-DOMAIN",
    );
  }

  const raw = runStructuralReview({ repoRoot: resolve(ctx.cwd), domains: options.domain ? [options.domain] : undefined });
  const consolidated = suppressKnownBenignFindings(consolidateFindings(raw.findings));

  const review: StructuralReview = {
    reviewCommit: raw.reviewCommit,
    generatedAt: new Date().toISOString(),
    domainsRequested: raw.domainsRequested,
    domainsSupported: raw.domainsSupported,
    domainsUnsupported: raw.domainsUnsupported,
    providerStatus: [{ providerId: "repository-local", available: true }],
    findings: consolidated,
  };

  const actionable = consolidated.filter((f) => f.disposition === "actionable").length;
  const intakeEligible = consolidated.filter((f) => f.eligibleForIntake).length;

  return makeResult({
    status: "passed",
    action: "review",
    projectStatus: null,
    currentMilestoneId: null,
    currentWorkUnitId: null,
    summary: `Structural review at ${raw.reviewCommit.slice(0, 12)}: ${consolidated.length} finding(s) (${actionable} actionable, ${intakeEligible} intake-eligible) across ${raw.domainsSupported.length} domain(s).`,
    exitCode: ExitCode.Success,
    data: { review },
  });
}
