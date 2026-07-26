import type { StateModel } from "../schema/state.schema.js";
import type { EvidenceGatePolicy, ActivePolicyRef } from "../schema/evidence-gate-policy.schema.js";

/** M28 §3: additive/optional state collection, empty by default on pre-M28 state. */
export function getEvidenceGatePolicies(state: StateModel): EvidenceGatePolicy[] {
  return state.evidenceGate?.policies ?? [];
}

export function getActivePolicyRef(state: StateModel): ActivePolicyRef | undefined {
  return state.evidenceGate?.activePolicyRef;
}

export function findPolicyVersions(policyId: string, policies: readonly EvidenceGatePolicy[]): EvidenceGatePolicy[] {
  return policies.filter((p) => p.policyId === policyId);
}

export function findPolicy(policyId: string, version: number, policies: readonly EvidenceGatePolicy[]): EvidenceGatePolicy | undefined {
  return policies.find((p) => p.policyId === policyId && p.version === version);
}

export function findLatestPolicyVersion(policyId: string, policies: readonly EvidenceGatePolicy[]): EvidenceGatePolicy | undefined {
  const versions = findPolicyVersions(policyId, policies);
  if (versions.length === 0) return undefined;
  return versions.reduce((latest, p) => (p.version > latest.version ? p : latest));
}

export function maxPolicyVersion(policyId: string, policies: readonly EvidenceGatePolicy[]): number {
  return findPolicyVersions(policyId, policies).reduce((max, p) => Math.max(max, p.version), 0);
}

/** M28 §5.1: resolves the exact policy to simulate against, given optional explicit policyId/version. */
export function resolveActivePolicy(state: StateModel): EvidenceGatePolicy | undefined {
  const ref = getActivePolicyRef(state);
  if (!ref) return undefined;
  return findPolicy(ref.policyId, ref.version, getEvidenceGatePolicies(state));
}
