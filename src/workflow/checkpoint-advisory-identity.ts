import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { AdvisoryEvaluationStatus, AdvisoryOverallResult, AdvisoryTrigger } from "../schema/checkpoint-evidence-advisory.schema.js";

/**
 * M29 §3.1: "observationId is deterministic from checkpoint ID, trigger
 * identity, policy digest/status, asOf, and simulation digest/status."
 * Reuses the M23 canonical-JSON/SHA-256 digest owner directly -- no second
 * canonicalization implementation.
 */
export function computeAdvisoryObservationId(input: {
  checkpointId: string;
  trigger: AdvisoryTrigger;
  evaluationStatus: AdvisoryEvaluationStatus;
  policyId: string | null;
  policyVersion: number | null;
  policyDigest: string | null;
  asOf: string;
  overallResult: AdvisoryOverallResult;
  simulationDigest: string | null;
}): string {
  return computeCanonicalPayloadDigest({
    protocolVersion: "aiqt-checkpoint-evidence-advisory-observation@1",
    checkpointId: input.checkpointId,
    trigger: input.trigger,
    evaluationStatus: input.evaluationStatus,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    policyDigest: input.policyDigest,
    asOf: input.asOf,
    overallResult: input.overallResult,
    simulationDigest: input.simulationDigest,
  });
}
