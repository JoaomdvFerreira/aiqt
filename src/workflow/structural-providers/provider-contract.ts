import type { StructuralFinding, StructuralProviderStatus } from "../../schema/structural-review.schema.js";

/**
 * Section 3.6/9: a narrow, read-only, provider-neutral optional-evidence
 * contract. `checkAvailability` must be a deterministic, local,
 * network-free check (Section 3.6: "never introduce hidden network or
 * credential requirements" for CORE review; a provider MAY need
 * network/credentials for its own operation, but availability detection
 * itself must not silently probe one). `collectEvidence` is called only
 * when `checkAvailability` reports available, and must never override
 * stronger repository-local evidence silently -- callers merge provider
 * findings through the same consolidation/suppression pipeline as any
 * other finding (Section 6).
 */
export interface StructuralEvidenceProvider {
  readonly providerId: string;
  checkAvailability(repoRoot: string): StructuralProviderStatus;
  collectEvidence(repoRoot: string, reviewCommit: string): StructuralFinding[];
}
