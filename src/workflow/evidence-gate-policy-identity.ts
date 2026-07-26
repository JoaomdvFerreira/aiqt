import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { EvidenceGatePolicy } from "../schema/evidence-gate-policy.schema.js";

/**
 * M28 §3.1/§5.7: reuses the exact M23 canonical-JSON digest helper --
 * never a second canonicalization/hashing implementation. The digest
 * covers only the policy's logical, user-supplied identity content
 * (protocolVersion/policyId/version/name/description/targetScopes/rules/
 * supersedesVersion); `createdAt` (an AIQT-assigned import-time fact, not
 * user-supplied content) and `policyDigest` itself are excluded, so
 * replaying byte-identical logical policy content on a different day
 * still produces the same digest -- exactly what "same identity and
 * digest is a no-op" requires to be meaningfully checkable.
 */
export interface PolicyDigestInput {
  protocolVersion: string;
  policyId: string;
  version: number;
  name: string;
  description?: string;
  targetScopes: readonly string[];
  rules: unknown;
  supersedesVersion?: number;
}

export function computePolicyDigest(input: PolicyDigestInput): string {
  return computeCanonicalPayloadDigest(input);
}

export function computePolicyDigestFromPolicy(policy: Omit<EvidenceGatePolicy, "policyDigest" | "createdAt">): string {
  return computePolicyDigest(policy);
}
