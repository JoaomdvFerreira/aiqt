import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { EvidenceEnforcementProfileInput, EvidenceEnforcementProfile } from "../schema/evidence-enforcement-profile.schema.js";

/** M30 §4.1: digest excludes profileDigest/createdAt, mirroring M28's computePolicyDigest exactly. computeCanonicalPayloadDigest already returns the `sha256:`-prefixed hex string (via sha256Hex). */
export function computeEnforcementProfileDigest(input: EvidenceEnforcementProfileInput): string {
  return computeCanonicalPayloadDigest(input);
}

export function computeEnforcementProfileDigestFromProfile(profile: EvidenceEnforcementProfile): string {
  const { profileDigest: _d, createdAt: _c, ...input } = profile;
  return computeEnforcementProfileDigest(input);
}
