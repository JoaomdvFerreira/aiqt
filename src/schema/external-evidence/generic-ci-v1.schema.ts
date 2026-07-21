import { z } from "zod";
import { EXTERNAL_EVIDENCE_MAX_CHECKS, BOUNDED_SHORT_STRING_MAX, BOUNDED_MEDIUM_STRING_MAX } from "./limits.js";
import { ExternalFindingSchema, ExternalArtifactSchema, TimestampSchema } from "./generic-evidence-v1.schema.js";

const BoundedShortString = z.string().min(1).max(BOUNDED_SHORT_STRING_MAX);
const BoundedMediumString = z.string().min(1).max(BOUNDED_MEDIUM_STRING_MAX);
const OptionalBoundedShortString = z.string().max(BOUNDED_SHORT_STRING_MAX).optional();

export const CiStatusSchema = z.enum(["passed", "failed", "partial", "cancelled", "not_run", "unknown"]);
export type CiStatus = z.infer<typeof CiStatusSchema>;

const CheckSchema = z
  .object({
    checkId: BoundedShortString,
    name: BoundedShortString,
    status: CiStatusSchema,
    summary: BoundedMediumString,
    durationMs: z.number().int().nonnegative().finite().optional(),
    findings: z.array(ExternalFindingSchema).max(50).optional(),
    artifacts: z.array(ExternalArtifactSchema).max(50).optional(),
  })
  .strict();
export type Check = z.infer<typeof CheckSchema>;

export const GenericCiV1Schema = z
  .object({
    format: z.literal("generic-ci-json@1"),
    externalId: OptionalBoundedShortString,
    source: z
      .object({
        providerId: BoundedShortString,
        workflowName: OptionalBoundedShortString,
        jobName: OptionalBoundedShortString,
      })
      .strict(),
    binding: z
      .object({
        workUnitId: BoundedShortString,
        packetId: BoundedShortString,
        checkpointId: OptionalBoundedShortString,
        implementationRootId: BoundedShortString,
        branch: OptionalBoundedShortString,
        commitSha: BoundedShortString,
        repositoryFingerprint: OptionalBoundedShortString,
      })
      .strict(),
    run: z
      .object({
        status: CiStatusSchema,
        startedAt: TimestampSchema.optional(),
        completedAt: TimestampSchema,
        summary: BoundedMediumString,
      })
      .strict(),
    checks: z.array(CheckSchema).max(EXTERNAL_EVIDENCE_MAX_CHECKS),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.checks.map((c) => c.checkId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate checkId in payload", path: ["checks"] });
    }
  });
export type GenericCiV1 = z.infer<typeof GenericCiV1Schema>;
