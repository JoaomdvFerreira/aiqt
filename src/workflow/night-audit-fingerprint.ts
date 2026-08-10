import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { AuditFinding, NightReviewDomain } from "../schema/night-audit.schema.js";

/**
 * M48-WU04 (build spec Sec 7/9): deterministic finding identity, mirroring
 * computeDefectFingerprint / computeStructuralFindingFingerprint exactly.
 * Built ONLY from structural identity fields (domain, checkId, scope, and
 * the sorted affected-paths/evidence-locators) -- NEVER from `title`/
 * `explanation` narrative text, so two textually-similar-but-unrelated
 * findings never collide and the same underlying condition always
 * fingerprints identically regardless of wording. Arrays are sorted before
 * digesting because canonicalizeJsonValue preserves array order verbatim
 * (only object keys are sorted) -- two submissions describing the same
 * finding via differently-ordered path/locator lists must still collide.
 */
export interface AuditFindingFingerprintInput {
  domain: NightReviewDomain;
  checkId: string;
  scope: string;
  affectedPaths: readonly string[];
  evidenceLocators: readonly string[];
}

export function computeAuditFindingFingerprint(input: AuditFindingFingerprintInput): string {
  return computeCanonicalPayloadDigest({
    domain: input.domain,
    checkId: input.checkId,
    scope: input.scope,
    affectedPaths: [...input.affectedPaths].sort(),
    evidenceLocators: [...input.evidenceLocators].sort(),
  });
}

/** Convenience: derives the fingerprint input directly from an already-normalized AuditFinding (before its own findingKey is assigned). */
export function computeAuditFindingFingerprintFromFinding(finding: Omit<AuditFinding, "findingKey">): string {
  return computeAuditFindingFingerprint({
    domain: finding.domain,
    checkId: finding.checkId,
    scope: finding.scope,
    affectedPaths: finding.affectedPaths,
    evidenceLocators: finding.evidence.map((e) => e.locator),
  });
}
