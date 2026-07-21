import type { ManualEvidenceV1 } from "../../schema/external-evidence/manual-evidence-v1.schema.js";
import type { NormalizedEvidenceCandidate } from "../../schema/external-evidence/normalized-evidence-candidate.js";
import type { TrustLevel } from "../../schema/evidence.schema.js";
import {
  mapExternalFindingToSourceFinding,
  mapExternalArtifactToArtifactReference,
} from "./generic-evidence-v1.adapter.js";

export const MANUAL_EVIDENCE_V1_ADAPTER_ID = "manual-evidence-json@1";

/** M23 §12 trust ceiling: fixed by the adapter, never elevated by the payload. */
export const MANUAL_EVIDENCE_V1_TRUST_LEVEL: TrustLevel = "self_reported";

/**
 * M23 §19: maps an already-schema-validated `ManualEvidenceV1` payload
 * into the internal `NormalizedEvidenceCandidate` transport DTO.
 * `reviewerType` is fixed to "human" by the adapter itself -- the format
 * has no `reviewerType` field, since manual evidence is definitionally a
 * human-authored record, never payload-asserted. Reuses the same
 * finding/artifact mapping (and artifact-safety enforcement) as the
 * generic-evidence adapter rather than reimplementing it. Unlike
 * generic-ci-json@1, manual evidence may carry decision-escalation
 * candidates (M23 §17).
 */
export function normalizeManualEvidenceV1(
  payload: ManualEvidenceV1,
  sourcePayloadDigest: string,
): NormalizedEvidenceCandidate {
  return {
    adapterId: MANUAL_EVIDENCE_V1_ADAPTER_ID,
    sourcePayloadDigest,
    externalEvidenceId: payload.externalId ?? null,
    provider: {
      providerId: payload.source.providerId,
      providerType: "human",
      trustLevel: MANUAL_EVIDENCE_V1_TRUST_LEVEL,
    },
    workflowBinding: {
      workUnitId: payload.binding.workUnitId,
      packetId: payload.binding.packetId,
      checkpointId: payload.binding.checkpointId ?? null,
      implementationRootId: payload.binding.implementationRootId,
    },
    codeBinding: {
      branch: payload.binding.branch,
      commitSha: payload.binding.commitSha,
      repositoryFingerprint: undefined,
      workingTreeFingerprint: undefined,
      capturedAt: payload.binding.capturedAt,
    },
    reviewer: {
      reviewerId: payload.reviewer.reviewerId,
      reviewerType: "human",
      independentContext: payload.reviewer.independentContext,
    },
    results: {
      reviewResult: payload.results.reviewResult,
      validationResult: payload.results.validationResult,
      acceptanceCriteriaResult: payload.results.acceptanceCriteriaResult,
      summary: payload.results.summary,
    },
    sourceFindings: (payload.findings ?? []).map(mapExternalFindingToSourceFinding),
    artifactReferences: (payload.artifacts ?? []).map(mapExternalArtifactToArtifactReference),
    decisionEscalationCandidates: (payload.decisionEscalations ?? []).map((candidate) => ({
      localId: candidate.escalationLocalId,
      category: candidate.category,
      question: candidate.question,
      rationale: candidate.rationale,
      proposedAnswer: candidate.proposedAnswer,
    })),
    capturedAt: payload.binding.capturedAt,
  };
}
