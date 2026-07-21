import { z } from "zod";
import {
  EXTERNAL_EVIDENCE_MAX_FINDINGS,
  EXTERNAL_EVIDENCE_MAX_ARTIFACTS,
  EXTERNAL_EVIDENCE_MAX_DECISION_ESCALATIONS,
  BOUNDED_SHORT_STRING_MAX,
  BOUNDED_MEDIUM_STRING_MAX,
} from "./limits.js";
import {
  ExternalFindingSchema,
  ExternalArtifactSchema,
  ExternalDecisionEscalationCandidateSchema,
  TimestampSchema,
} from "./generic-evidence-v1.schema.js";

const BoundedShortString = z.string().min(1).max(BOUNDED_SHORT_STRING_MAX);
const BoundedMediumString = z.string().min(1).max(BOUNDED_MEDIUM_STRING_MAX);
const OptionalBoundedShortString = z.string().max(BOUNDED_SHORT_STRING_MAX).optional();

export const ManualEvidenceV1Schema = z
  .object({
    format: z.literal("manual-evidence-json@1"),
    externalId: OptionalBoundedShortString,
    source: z
      .object({
        providerId: BoundedShortString,
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
        capturedAt: TimestampSchema,
      })
      .strict(),
    reviewer: z
      .object({
        reviewerId: OptionalBoundedShortString,
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
export type ManualEvidenceV1 = z.infer<typeof ManualEvidenceV1Schema>;
