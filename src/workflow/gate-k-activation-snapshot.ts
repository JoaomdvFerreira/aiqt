import type { StateModel } from "../schema/state.schema.js";
import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import { getRecoveryProofs, getRequiredEvidenceExceptions } from "../services/evidence-enforcement-service.js";

/**
 * M30 §4.6/§4.6.1: "activation snapshot includes profile/policy digests,
 * advisory telemetry, relevant issue state, recovery-proof digests, Work
 * Unit statuses, effective checkpoint references, and grandfathering set."
 * Reuses the M23 canonical-JSON/SHA-256 digest owner directly. Any relevant
 * change (profile, policy, evidence, feedback, issue, Work Unit, checkpoint,
 * proof, or grandfathering input) changes this digest, which is exactly how
 * snapshot-currency drift is detected at activate time.
 */
export function computeActivationSnapshotDigest(params: {
  state: StateModel;
  profileId: string;
  profileVersion: number;
  profileDigest: string;
  policyId: string;
  policyVersion: number;
  policyDigest: string;
  grandfatheredWorkUnitIds: readonly string[];
}): string {
  const { state } = params;
  const workUnitStatuses = [...state.workGraph.workUnits]
    .map((wu) => ({ id: wu.id, status: wu.status }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const checkpointRefs = [...state.checkpoints].map((cp) => ({ id: cp.id, workUnitId: cp.workUnitId, createdAt: cp.createdAt })).sort((a, b) => a.id.localeCompare(b.id));
  const issueState = [...(state.issues?.projectIssues ?? [])]
    .map((pi) => ({ issueKey: pi.issueKey, updatedAt: pi.updatedAt }))
    .sort((a, b) => a.issueKey.localeCompare(b.issueKey));
  const feedbackState = [...(state.evidenceAdvisoryFeedback ?? [])]
    .map((f) => ({ issueKey: f.issueKey, classification: f.classification, updatedAt: f.updatedAt }))
    .sort((a, b) => a.issueKey.localeCompare(b.issueKey));
  const recoveryProofDigests = getRecoveryProofs(state)
    .map((p) => p.proofDigest)
    .sort();
  const activeExceptionIds = getRequiredEvidenceExceptions(state)
    .filter((e) => e.status === "active")
    .map((e) => e.exceptionId)
    .sort();

  return computeCanonicalPayloadDigest({
    protocolVersion: "aiqt-gate-k-activation-snapshot@1",
    profileId: params.profileId,
    profileVersion: params.profileVersion,
    profileDigest: params.profileDigest,
    policyId: params.policyId,
    policyVersion: params.policyVersion,
    policyDigest: params.policyDigest,
    workUnitStatuses,
    checkpointRefs,
    issueState,
    feedbackState,
    recoveryProofDigests,
    activeExceptionIds,
    grandfatheredWorkUnitIds: [...params.grandfatheredWorkUnitIds].sort(),
  });
}
