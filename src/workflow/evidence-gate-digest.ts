import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { NormalizedEvidenceSnapshotEntry, EvidenceGateRuleResult, SimulationTarget } from "../schema/evidence-gate-simulation.schema.js";
import { EVIDENCE_SNAPSHOT_PROTOCOL_VERSION, EVIDENCE_GATE_SIMULATION_DIGEST_PROTOCOL_VERSION } from "../schema/evidence-gate-simulation.schema.js";

/**
 * M28 §5.7.1: reuses the exact M23 canonical-JSON/SHA-256 helper -- never
 * a second canonicalization implementation. Entries must already be
 * sorted lexicographically by evidenceId (buildEvidenceSnapshotEntries
 * guarantees this) and each entry's own scopeRefs/artifactKinds arrays
 * must already be sorted+deduplicated (normalizeEvidenceRecord
 * guarantees this) before this function is called.
 */
export function computeEvidenceSnapshotDigest(target: Pick<SimulationTarget, "type" | "id">, entries: readonly NormalizedEvidenceSnapshotEntry[]): string {
  return computeCanonicalPayloadDigest({
    protocolVersion: EVIDENCE_SNAPSHOT_PROTOCOL_VERSION,
    target: { type: target.type, id: target.id },
    entries,
  });
}

/** M28 §5.7.2's exact normalization: sorted matchedEvidenceRefs, fixed enums/integers, summary/generatedAt excluded. */
export interface NormalizedRuleResultForDigest {
  ruleId: string;
  result: string;
  requiredCount: number;
  matchedCount: number;
  matchedEvidenceRefs: string[];
  rejectedCandidateCounts: EvidenceGateRuleResult["rejectedCandidateCounts"];
  reasonCode: string;
}

export function normalizeRuleResultForDigest(result: EvidenceGateRuleResult): NormalizedRuleResultForDigest {
  return {
    ruleId: result.ruleId,
    result: result.result,
    requiredCount: result.requiredCount,
    matchedCount: result.matchedCount,
    matchedEvidenceRefs: Array.from(new Set(result.matchedEvidenceRefs)).sort(),
    rejectedCandidateCounts: result.rejectedCandidateCounts,
    reasonCode: result.reasonCode,
  };
}

/**
 * M28 §5.7.2: `asOf`, `policyDigest`, and `evidenceSnapshotDigest` must
 * already be the canonical values used to produce this simulation.
 */
export function computeSimulationDigest(params: {
  policyDigest: string;
  target: Pick<SimulationTarget, "type" | "id">;
  asOf: string;
  evidenceSnapshotDigest: string;
  ruleResults: readonly EvidenceGateRuleResult[];
}): string {
  const normalizedRuleResults = params.ruleResults
    .map(normalizeRuleResultForDigest)
    .slice()
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  return computeCanonicalPayloadDigest({
    protocolVersion: EVIDENCE_GATE_SIMULATION_DIGEST_PROTOCOL_VERSION,
    policyDigest: params.policyDigest,
    target: { type: params.target.type, id: params.target.id },
    asOf: params.asOf,
    evidenceSnapshotDigest: params.evidenceSnapshotDigest,
    ruleResults: normalizedRuleResults,
  });
}
