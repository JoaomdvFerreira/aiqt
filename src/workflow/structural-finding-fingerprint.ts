import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { StructuralReviewDomain } from "../schema/structural-review.schema.js";

/**
 * Section 3.2/3.4/6.1: deterministic finding identity. Built ONLY from
 * domain + rule + a bounded structural evidence signature -- deliberately
 * EXCLUDES `reviewCommit`, so the same real structural condition keeps
 * the same `findingKey` across commits (enabling cross-run consolidation
 * and tracking) while `reviewCommit` remains a separate freshness field
 * intake compares against current HEAD (Section 3.4). Never built from
 * the finding's title/explanation text, so two structurally-unrelated
 * findings that happen to read similarly never collide (mirrors M42's
 * defect-fingerprint discipline).
 */
export interface StructuralFindingFingerprintInput {
  domain: StructuralReviewDomain;
  ruleId: string;
  /** A bounded, structural signature of what was actually found -- e.g. sorted affected paths + a rule-specific evidence key. Never raw file content. */
  evidenceSignature: string;
}

export function computeStructuralFindingFingerprint(input: StructuralFindingFingerprintInput): string {
  return computeCanonicalPayloadDigest({
    domain: input.domain,
    ruleId: input.ruleId,
    evidenceSignature: input.evidenceSignature,
  });
}
