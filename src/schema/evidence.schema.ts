import { z } from "zod";
import { DecisionEscalationSchema } from "./decision-escalation.schema.js";

/** M22 §5.1: normative ordinal trust model. Comparison is `actual >= minimum`. */
export const TrustLevelSchema = z.enum([
  "unverified",
  "self_reported",
  "repository_local",
  "platform_verified",
]);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

export const TRUST_LEVEL_ORDER: Readonly<Record<TrustLevel, number>> = {
  unverified: 0,
  self_reported: 1,
  repository_local: 2,
  platform_verified: 3,
};

/** `actual >= minimum`. Unknown values are invalid input, not silently downgraded (M22 §5.1). */
export function meetsTrustLevel(actual: TrustLevel, minimum: TrustLevel): boolean {
  return TRUST_LEVEL_ORDER[actual] >= TRUST_LEVEL_ORDER[minimum];
}

/** M22 §7.4: per-record and per-collection caps. Not increased without review. */
export const EVIDENCE_MAX_SERIALIZED_BYTES = 65536;
export const EVIDENCE_MAX_SOURCE_FINDINGS = 100;
export const EVIDENCE_MAX_ARTIFACT_REFERENCES = 50;
export const EVIDENCE_MAX_DECISION_ESCALATION_REFS = 50;
export const EVIDENCE_RECORDS_HARD_CAP = 10000;

const BOUNDED_SHORT = 500;
const BOUNDED_MEDIUM = 2000;
const BOUNDED_LOCATOR = 2048;

export const ProviderTypeSchema = z.enum([
  "human",
  "agent",
  "repository",
  "ci",
  "platform",
  "manual",
  "unknown",
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ReviewerTypeSchema = z.enum(["human", "agent", "system", "unknown"]);
export type ReviewerType = z.infer<typeof ReviewerTypeSchema>;

export const IndependentContextSchema = z.enum([
  "declared_independent",
  "declared_not_independent",
  "unknown",
]);
export type IndependentContext = z.infer<typeof IndependentContextSchema>;

export const ReviewOutcomeSchema = z.enum(["passed", "failed", "partial", "not_run", "unknown"]);
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;

export const AcceptanceOutcomeSchema = z.enum([
  "passed",
  "failed",
  "partial",
  "not_checked",
  "unknown",
]);
export type AcceptanceOutcome = z.infer<typeof AcceptanceOutcomeSchema>;

/** M22 §5.3: a reference only -- M22 never fetches, opens, validates, copies, or persists the artifact body. */
export const ArtifactKindSchema = z.enum([
  "log",
  "report",
  "screenshot",
  "test_result",
  "ci_run",
  "diff",
  "other",
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const DigestAlgorithmSchema = z.enum(["sha256"]);
export type DigestAlgorithm = z.infer<typeof DigestAlgorithmSchema>;

export const ArtifactReferenceSchema = z.object({
  artifactId: z.string().min(1),
  kind: ArtifactKindSchema,
  locator: z.string().min(1).max(BOUNDED_LOCATOR),
  digest: z
    .object({
      algorithm: DigestAlgorithmSchema,
      value: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    })
    .optional(),
  mediaType: z.string().max(BOUNDED_SHORT).optional(),
  description: z.string().max(BOUNDED_MEDIUM).optional(),
});
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

/** M22 §5.4: source severity/fixability/scope are claims only -- never authoritative (see M22 §6.5). */
export const SourceSeverityClaimSchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
  "unknown",
]);
export type SourceSeverityClaim = z.infer<typeof SourceSeverityClaimSchema>;

export const SourceFixabilityClaimSchema = z.enum([
  "agent_fixable",
  "human_action",
  "external_verification",
  "unknown",
]);
export type SourceFixabilityClaim = z.infer<typeof SourceFixabilityClaimSchema>;

export const ScopeClaimSchema = z.enum([
  "execution_local",
  "work_unit",
  "cross_work_unit",
  "milestone",
  "project",
  "release",
  "architecture",
  "security",
  "legal_compliance",
  "governance",
  "external_setup",
  "unknown",
]);
export type ScopeClaim = z.infer<typeof ScopeClaimSchema>;

export const SourceFindingSchema = z.object({
  sourceFindingId: z.string().min(1),
  sourceFingerprint: z.string().min(1),
  title: z.string().min(1).max(BOUNDED_SHORT),
  summary: z.string().min(1).max(BOUNDED_MEDIUM),
  sourceSeverityClaim: SourceSeverityClaimSchema,
  sourceFixabilityClaim: SourceFixabilityClaimSchema,
  scopeClaim: ScopeClaimSchema,
  relatedIds: z.array(z.string()).max(100),
  evidenceTextDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type SourceFinding = z.infer<typeof SourceFindingSchema>;

export const EvidenceContractVersionSchema = z
  .string()
  .regex(/^\d+\.\d+$/, "contractVersion must be a supported major.minor version string");

/**
 * M23-WU02 §16: additive, optional provenance of an EvidenceRecord created
 * via `aiqt evidence import`. Absent entirely on every EvidenceRecord
 * created through any pre-M23 path, and never materialized by a read-only
 * command. Carries no raw payload, filename, stdin content, or absolute
 * path -- only the identity facts M23 itself computed.
 */
export const ImportProvenanceSchema = z
  .object({
    adapterId: z.string().min(1),
    sourcePayloadDigest: z.string().min(1),
    externalEvidenceId: z.string().min(1).optional(),
    importIdentityKey: z.string().min(1),
    importedAt: z.string(),
  })
  .strict();
export type ImportProvenance = z.infer<typeof ImportProvenanceSchema>;

export const EvidenceRecordSchema = z
  .object({
    evidenceId: z.string().min(1),
    contractVersion: EvidenceContractVersionSchema,
    provider: z.object({
      providerId: z.string().min(1),
      providerType: ProviderTypeSchema,
      trustLevel: TrustLevelSchema,
    }),
    workflowBinding: z.object({
      workUnitId: z.string().min(1),
      packetId: z.string().min(1),
      checkpointId: z.string().min(1).optional(),
      implementationRootId: z.string().min(1),
    }),
    codeBinding: z.object({
      branch: z.string().optional(),
      commitSha: z.string().optional(),
      repositoryFingerprint: z.string().optional(),
      workingTreeFingerprint: z.string().optional(),
      capturedAt: z.string(),
    }),
    reviewer: z.object({
      reviewerId: z.string().optional(),
      reviewerType: ReviewerTypeSchema,
      independentContext: IndependentContextSchema,
    }),
    results: z.object({
      reviewResult: ReviewOutcomeSchema,
      validationResult: ReviewOutcomeSchema,
      acceptanceCriteriaResult: AcceptanceOutcomeSchema,
      summary: z.string().min(1).max(BOUNDED_MEDIUM),
    }),
    sourceFindings: z.array(SourceFindingSchema).max(EVIDENCE_MAX_SOURCE_FINDINGS),
    decisionEscalationIds: z.array(z.string()).max(EVIDENCE_MAX_DECISION_ESCALATION_REFS),
    artifactReferences: z.array(ArtifactReferenceSchema).max(EVIDENCE_MAX_ARTIFACT_REFERENCES),
    recordedAt: z.string(),
    importProvenance: ImportProvenanceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > EVIDENCE_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `EvidenceRecord exceeds max_serialized_bytes (${EVIDENCE_MAX_SERIALIZED_BYTES})`,
      });
    }
  });
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/**
 * M22 §5.8: deterministic derived binding-status values. Never persisted as
 * a rewrite of the evidence's own stored binding facts -- always computed
 * on demand by evidence-binding-service.ts from those facts.
 */
export const EvidenceBindingStatusSchema = z.enum([
  "current",
  "stale",
  "mismatched",
  "unavailable",
  "unknown",
]);
export type EvidenceBindingStatus = z.infer<typeof EvidenceBindingStatusSchema>;

/**
 * M22-WU02: new, optional, top-level state section -- same additive
 * pattern as `state.review`/`state.checkpointAmendments`. Missing entirely
 * on pre-M22 state files; never materialized by a read-only command.
 */
export const EvidenceStateSchema = z.object({
  records: z.array(EvidenceRecordSchema),
  decisionEscalations: z.array(DecisionEscalationSchema),
});
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;
