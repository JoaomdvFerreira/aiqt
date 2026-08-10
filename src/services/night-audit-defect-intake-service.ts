import type { DefectExternalIssueRef, DefectRecord } from "../schema/defect.schema.js";
import type { AuditFinding } from "../schema/night-audit.schema.js";
import { evaluateStructuralFindingFreshness } from "../workflow/structural-review-freshness.js";
import { evaluateAuditFinding } from "../workflow/night-audit-quality-gate.js";
import { auditFindingToDiscoveryCandidate } from "../workflow/night-audit-finding-defect-adapter.js";
import { fingerprintCandidate } from "../workflow/defect-discovery.js";
import { applyDiscoveryCandidates, type DiscoveryApplyResult } from "./defect-discovery-service.js";

/**
 * M48-WU04 (build spec Sec 7/9): the sole AuditFinding intake path,
 * mirroring structural-finding-intake-service.ts exactly.
 *
 * 1. verify freshness against the current review commit (a stale finding
 *    is rejected, never silently promoted) -- reuses
 *    evaluateStructuralFindingFreshness() directly: despite its name, it
 *    is a pure, generic (reviewCommit, currentCommit) => current|stale
 *    comparison with no StructuralFinding-specific logic, so a second,
 *    duplicate freshness function is unnecessary;
 * 2. re-verify the quality gate defensively (never trust the caller alone
 *    already filtered -- mirrors M43's own disposition/eligibility
 *    re-check at the intake boundary);
 * 3. adapt into an M42 DiscoveryCandidate and reuse
 *    applyDiscoveryCandidates verbatim -- M42's own dedup/fingerprint
 *    logic decides create-vs-enrich (dedup check #1, build spec Sec 9),
 *    never reimplemented here;
 * 4. report whether the resulting/matched defect already carries a
 *    published externalIssueRef (dedup check #2, build spec Sec 9) --
 *    the caller (WU48-05) uses this to skip a redundant Issue-search/
 *    create pass entirely.
 *
 * Intake only ever produces/enriches a `candidate`-status defect -- it
 * never authorizes remediation, triages, or queues anything itself.
 */
export type NightAuditIntakeOutcome =
  | { ok: true; result: DiscoveryApplyResult; matchedDefect: DefectRecord; alreadyPublished: boolean; existingExternalIssueRef: DefectExternalIssueRef | null }
  | { ok: false; reason: string; stale?: boolean };

export function intakeAuditFinding(finding: AuditFinding, currentReviewCommit: string, existingDefects: readonly DefectRecord[], now: string): NightAuditIntakeOutcome {
  const freshness = evaluateStructuralFindingFreshness(finding.reviewCommit, currentReviewCommit);
  if (freshness === "stale") {
    return {
      ok: false,
      stale: true,
      reason: `Finding "${finding.findingKey}" was derived from commit ${finding.reviewCommit}, which no longer matches the current repository state (${currentReviewCommit}). Re-run the ReviewTask before intake.`,
    };
  }

  const gate = evaluateAuditFinding(finding);
  if (gate.decision === "reject") {
    return {
      ok: false,
      reason: `Finding "${finding.findingKey}" did not pass the quality gate: ${gate.reasons.join(" ")}`,
    };
  }

  const candidate = auditFindingToDiscoveryCandidate(finding, now);
  const result = applyDiscoveryCandidates(existingDefects, [candidate], now);
  const fingerprint = fingerprintCandidate(candidate);
  const matchedDefect = result.defects.find((d) => d.fingerprint === fingerprint);

  if (!matchedDefect) {
    // Only reachable if the defect cap (MAX_DEFECTS) was already reached and the candidate was skipped.
    return { ok: false, reason: `Finding "${finding.findingKey}" could not be intaken: the canonical defect cap has been reached.` };
  }

  return {
    ok: true,
    result,
    matchedDefect,
    alreadyPublished: matchedDefect.externalIssueRef !== undefined,
    existingExternalIssueRef: matchedDefect.externalIssueRef ?? null,
  };
}
