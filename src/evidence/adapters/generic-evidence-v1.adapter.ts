import type {
  GenericEvidenceV1,
  ExternalFinding,
  ExternalArtifact,
  ExternalDecisionEscalationCandidate,
} from "../../schema/external-evidence/generic-evidence-v1.schema.js";
import type {
  NormalizedEvidenceCandidate,
  NormalizedDecisionEscalationCandidate,
} from "../../schema/external-evidence/normalized-evidence-candidate.js";
import type { ProviderType, SourceFinding, ArtifactReference, TrustLevel } from "../../schema/evidence.schema.js";
import { computeSourceFingerprint } from "../../workflow/finding-fingerprint.js";
import { validateArtifactLocator } from "../../schema/external-evidence/artifact-safety.js";

export const GENERIC_EVIDENCE_V1_ADAPTER_ID = "generic-evidence-json@1";

/** M23 §12 trust ceiling: fixed by the adapter, never elevated by the payload. */
export const GENERIC_EVIDENCE_V1_TRUST_LEVEL: TrustLevel = "unverified";

export class UnsafeArtifactLocatorError extends Error {
  constructor(
    public readonly artifactId: string,
    public readonly reason: string,
  ) {
    super(`Artifact '${artifactId}' has an unsafe locator: ${reason}`);
    this.name = "UnsafeArtifactLocatorError";
  }
}

/**
 * M22's ProviderTypeSchema has no "system" member. "system" is mapped to
 * "unknown" rather than the closer-sounding "platform", since "platform"
 * implies a verification tier this adapter's fixed `unverified` trust
 * ceiling must never imply.
 */
function mapProviderType(providerType: GenericEvidenceV1["source"]["providerType"]): ProviderType {
  switch (providerType) {
    case "agent":
      return "agent";
    case "repository":
      return "repository";
    case "system":
      return "unknown";
    case "unknown":
      return "unknown";
  }
}

/** Shared with other adapters (e.g. the generic-CI adapter's per-check findings) -- not reimplemented per format. */
export function mapExternalFindingToSourceFinding(finding: ExternalFinding): SourceFinding {
  const scopeClaim = finding.scopeClaim ?? "unknown";
  const relatedIds = finding.relatedIds ?? [];
  return {
    sourceFindingId: finding.findingId,
    sourceFingerprint: computeSourceFingerprint({
      title: finding.title,
      summary: finding.summary,
      relatedIds,
      scopeClaim,
    }),
    title: finding.title,
    summary: finding.summary,
    sourceSeverityClaim: finding.severityClaim ?? "unknown",
    sourceFixabilityClaim: finding.fixabilityClaim ?? "unknown",
    scopeClaim,
    relatedIds,
  };
}

/** Shared with other adapters (e.g. the generic-CI adapter's per-check artifacts) -- not reimplemented per format. */
export function mapExternalArtifactToArtifactReference(artifact: ExternalArtifact): ArtifactReference {
  const locatorResult = validateArtifactLocator(artifact.locator);
  if (!locatorResult.ok) {
    throw new UnsafeArtifactLocatorError(artifact.artifactId, locatorResult.reason);
  }
  return {
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    locator: locatorResult.normalized,
    digest:
      artifact.digestAlgorithm && artifact.digestValue
        ? { algorithm: artifact.digestAlgorithm, value: artifact.digestValue }
        : undefined,
    mediaType: artifact.mediaType,
    description: artifact.description,
  };
}

function mapDecisionEscalation(
  candidate: ExternalDecisionEscalationCandidate,
): NormalizedDecisionEscalationCandidate {
  return {
    localId: candidate.escalationLocalId,
    category: candidate.category,
    question: candidate.question,
    rationale: candidate.rationale,
    proposedAnswer: candidate.proposedAnswer,
  };
}

/**
 * M23 §19: maps an already-schema-validated `GenericEvidenceV1` payload
 * into the internal `NormalizedEvidenceCandidate` transport DTO. Performs
 * no I/O, no persistence, no ID allocation -- purely a pure mapping
 * function, reusing M22's `computeSourceFingerprint` for every finding
 * rather than reimplementing fingerprinting here. Throws
 * `UnsafeArtifactLocatorError` if any artifact locator fails the M23 §11
 * artifact-safety check; the caller must treat that as a rejected import
 * (exit 3, no mutation), never a partially-normalized candidate.
 */
export function normalizeGenericEvidenceV1(
  payload: GenericEvidenceV1,
  sourcePayloadDigest: string,
): NormalizedEvidenceCandidate {
  return {
    adapterId: GENERIC_EVIDENCE_V1_ADAPTER_ID,
    sourcePayloadDigest,
    externalEvidenceId: payload.externalId ?? null,
    provider: {
      providerId: payload.source.providerId,
      providerType: mapProviderType(payload.source.providerType),
      trustLevel: GENERIC_EVIDENCE_V1_TRUST_LEVEL,
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
      repositoryFingerprint: payload.binding.repositoryFingerprint,
      workingTreeFingerprint: payload.binding.workingTreeFingerprint,
      capturedAt: payload.binding.capturedAt,
    },
    reviewer: {
      reviewerId: payload.reviewer.reviewerId,
      reviewerType: payload.reviewer.reviewerType,
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
    decisionEscalationCandidates: (payload.decisionEscalations ?? []).map(mapDecisionEscalation),
    capturedAt: payload.binding.capturedAt,
  };
}
