import type { ProviderType, ReviewerType, IndependentContext, ReviewOutcome, AcceptanceOutcome, TrustLevel, SourceFinding, ArtifactReference } from "../evidence.schema.js";

/**
 * M23 §5: internal transport object produced by every adapter. NOT a
 * second canonical evidence schema -- it exists only to carry adapter
 * output into the M22 EvidenceRecord shape (evidence-import-service.ts),
 * and is never itself persisted or independently validated as canonical
 * state.
 */
export interface NormalizedEvidenceCandidate {
  adapterId: string;
  sourcePayloadDigest: string;
  externalEvidenceId: string | null;
  provider: {
    providerId: string;
    providerType: ProviderType;
    trustLevel: TrustLevel;
  };
  workflowBinding: {
    workUnitId: string;
    packetId: string;
    checkpointId: string | null;
    implementationRootId: string;
  };
  codeBinding: {
    branch?: string;
    commitSha?: string;
    repositoryFingerprint?: string;
    workingTreeFingerprint?: string;
    capturedAt: string;
  };
  reviewer: {
    reviewerId?: string;
    reviewerType: ReviewerType;
    independentContext: IndependentContext;
  };
  results: {
    reviewResult: ReviewOutcome;
    validationResult: ReviewOutcome;
    acceptanceCriteriaResult: AcceptanceOutcome;
    summary: string;
  };
  sourceFindings: SourceFinding[];
  artifactReferences: ArtifactReference[];
  decisionEscalationCandidates: NormalizedDecisionEscalationCandidate[];
  capturedAt: string;
}

export interface NormalizedDecisionEscalationCandidate {
  localId: string;
  category: "product" | "architecture" | "security" | "legal_compliance" | "governance" | "external_setup" | "other";
  question: string;
  rationale: string;
  proposedAnswer?: string;
}
