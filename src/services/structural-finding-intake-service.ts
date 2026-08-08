import type { DefectRecord } from "../schema/defect.schema.js";
import type { StructuralFinding } from "../schema/structural-review.schema.js";
import { evaluateStructuralFindingFreshness } from "../workflow/structural-review-freshness.js";
import { structuralFindingToDiscoveryCandidate } from "../workflow/structural-finding-defect-adapter.js";
import { applyDiscoveryCandidates, type DiscoveryApplyResult } from "./defect-discovery-service.js";

export type StructuralIntakeOutcome =
  | { ok: true; result: DiscoveryApplyResult }
  | { ok: false; reason: string; stale?: boolean };

/**
 * Section 3.4/8/WU43-04: the sole structural-finding intake path.
 * 1. verify freshness against current HEAD (a stale finding is rejected,
 *    never silently promoted to a current defect);
 * 2. verify intake eligibility (disposition "actionable" and
 *    eligibleForIntake -- a suppressed/informational finding is never
 *    intake-eligible regardless of caller intent);
 * 3. adapt into an M42 DiscoveryCandidate and reuse
 *    applyDiscoveryCandidates verbatim -- M42's own dedup/fingerprint
 *    logic decides create-vs-enrich, never reimplemented here.
 * Intake only ever produces/enriches a `candidate`-status defect (the
 * same status M42 discovery itself produces) -- it never authorizes
 * remediation, triages, or queues anything itself (Section 3.3/8).
 */
export function intakeStructuralFinding(
  finding: StructuralFinding,
  currentReviewCommit: string,
  existingDefects: readonly DefectRecord[],
  now: string,
): StructuralIntakeOutcome {
  const freshness = evaluateStructuralFindingFreshness(finding.reviewCommit, currentReviewCommit);
  if (freshness === "stale") {
    return {
      ok: false,
      stale: true,
      reason: `Finding "${finding.findingKey}" was derived from commit ${finding.reviewCommit}, which no longer matches the current repository state (${currentReviewCommit}). Re-run "aiqt review structural" to re-evaluate before intake.`,
    };
  }

  if (finding.disposition !== "actionable" || !finding.eligibleForIntake) {
    return {
      ok: false,
      reason: `Finding "${finding.findingKey}" is not eligible for defect intake (disposition="${finding.disposition}", eligibleForIntake=${finding.eligibleForIntake}). Only actionable, intake-eligible findings may enter the defect queue.`,
    };
  }

  const candidate = structuralFindingToDiscoveryCandidate(finding, now);
  const result = applyDiscoveryCandidates(existingDefects, [candidate], now);
  return { ok: true, result };
}
