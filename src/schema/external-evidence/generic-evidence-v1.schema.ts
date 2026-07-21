import { z } from "zod";
import {
  EXTERNAL_EVIDENCE_MAX_FINDINGS,
  EXTERNAL_EVIDENCE_MAX_ARTIFACTS,
  EXTERNAL_EVIDENCE_MAX_DECISION_ESCALATIONS,
  BOUNDED_SHORT_STRING_MAX,
  BOUNDED_MEDIUM_STRING_MAX,
} from "./limits.js";

/** M23 §7.1: canonical timestamp -- reuses the repository's existing plain-string timestamp convention (validated for non-emptiness/ISO shape, matching M22 schemas). */
const TimestampSchema = z
  .string()
  .min(1)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "must be an ISO-8601 UTC timestamp");

const BoundedShortString = z.string().min(1).max(BOUNDED_SHORT_STRING_MAX);
const BoundedMediumString = z.string().min(1).max(BOUNDED_MEDIUM_STRING_MAX);
const OptionalBoundedShortString = z.string().max(BOUNDED_SHORT_STRING_MAX).optional();

const ExternalFindingSchema = z
  .object({
    findingId: BoundedShortString,
    title: BoundedShortString,
    summary: BoundedMediumString,
    severityClaim: z.enum(["critical", "high", "medium", "low", "info", "unknown"]).optional(),
    fixabilityClaim: z.enum(["agent_fixable", "human_action", "external_verification", "unknown"]).optional(),
    scopeClaim: z
      .enum([
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
      ])
      .optional(),
    relatedIds: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();

const ExternalArtifactSchema = z
  .object({
    artifactId: BoundedShortString,
    kind: z.enum(["log", "report", "screenshot", "test_result", "ci_run", "diff", "other"]),
    locator: z.string().min(1).max(2048),
    digestAlgorithm: z.enum(["sha256"]).optional(),
    digestValue: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    mediaType: OptionalBoundedShortString,
    description: z.string().max(BOUNDED_MEDIUM_STRING_MAX).optional(),
  })
  .strict();

const ExternalDecisionEscalationCandidateSchema = z
  .object({
    escalationLocalId: BoundedShortString,
    category: z.enum(["product", "architecture", "security", "legal_compliance", "governance", "external_setup", "other"]),
    question: BoundedMediumString,
    rationale: BoundedMediumString,
    proposedAnswer: z.string().max(BOUNDED_MEDIUM_STRING_MAX).optional(),
  })
  .strict();

export const GenericEvidenceV1Schema = z
  .object({
    format: z.literal("generic-evidence-json@1"),
    externalId: OptionalBoundedShortString,
    source: z
      .object({
        providerId: BoundedShortString,
        providerType: z.enum(["agent", "repository", "system", "unknown"]),
      })
      .strict(),
    binding: z
      .object({
        workUnitId: BoundedShortString,
        packetId: BoundedShortString,
        checkpointId: OptionalBoundedShortString,
        implementationRootId: BoundedShortString,
        branch: OptionalBoundedShortString,
        commitSha: OptionalBoundedShortString,
        repositoryFingerprint: OptionalBoundedShortString,
        workingTreeFingerprint: OptionalBoundedShortString,
        capturedAt: TimestampSchema,
      })
      .strict(),
    reviewer: z
      .object({
        reviewerId: OptionalBoundedShortString,
        reviewerType: z.enum(["agent", "system", "unknown"]),
        independentContext: z.enum(["declared_independent", "declared_not_independent", "unknown"]),
      })
      .strict(),
    results: z
      .object({
        reviewResult: z.enum(["passed", "failed", "partial", "not_run", "unknown"]),
        validationResult: z.enum(["passed", "failed", "partial", "not_run", "unknown"]),
        acceptanceCriteriaResult: z.enum(["passed", "failed", "partial", "not_checked", "unknown"]),
        summary: BoundedMediumString,
      })
      .strict(),
    findings: z.array(ExternalFindingSchema).max(EXTERNAL_EVIDENCE_MAX_FINDINGS).optional(),
    artifacts: z.array(ExternalArtifactSchema).max(EXTERNAL_EVIDENCE_MAX_ARTIFACTS).optional(),
    decisionEscalations: z
      .array(ExternalDecisionEscalationCandidateSchema)
      .max(EXTERNAL_EVIDENCE_MAX_DECISION_ESCALATIONS)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = (value.findings ?? []).map((f) => f.findingId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate findingId in payload", path: ["findings"] });
    }
    const artifactIds = (value.artifacts ?? []).map((a) => a.artifactId);
    if (new Set(artifactIds).size !== artifactIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate artifactId in payload", path: ["artifacts"] });
    }
    const escalationIds = (value.decisionEscalations ?? []).map((e) => e.escalationLocalId);
    if (new Set(escalationIds).size !== escalationIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate escalationLocalId in payload",
        path: ["decisionEscalations"],
      });
    }
  });
export type GenericEvidenceV1 = z.infer<typeof GenericEvidenceV1Schema>;
export type ExternalFinding = z.infer<typeof ExternalFindingSchema>;
export type ExternalArtifact = z.infer<typeof ExternalArtifactSchema>;
export type ExternalDecisionEscalationCandidate = z.infer<typeof ExternalDecisionEscalationCandidateSchema>;

export { ExternalFindingSchema, ExternalArtifactSchema, ExternalDecisionEscalationCandidateSchema, TimestampSchema };
