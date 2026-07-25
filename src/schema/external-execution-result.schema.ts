import { z } from "zod";
import { ExternalAgentRefSchema } from "./external-agent-ref.schema.js";
import {
  GENERIC_MAX_SUMMARY_CHARS,
  GENERIC_MAX_VALIDATION_CLAIMS,
  GENERIC_MAX_COMMIT_REFS,
  GENERIC_MAX_EVIDENCE_REFS,
  GENERIC_MAX_CONTINUATION_REASON_CHARS,
} from "./adapter-registry.js";

export const GenericResultClassSchema = z.enum(["success", "limited", "unavailable", "failed"]);
export type GenericResultClass = z.infer<typeof GenericResultClassSchema>;

/**
 * M27R §3.5: validation claims are always self-reported. `trust` is a
 * fixed literal -- there is no path that upgrades a validation claim to
 * verified/platform-checked evidence anywhere in this contract.
 */
export const ValidationClaimSchema = z
  .object({
    command: z.string().min(1).max(500),
    status: z.enum(["passed", "failed", "not_run"]),
    summary: z.string().max(GENERIC_MAX_SUMMARY_CHARS).optional(),
    trust: z.literal("self_reported"),
  })
  .strict();
export type ValidationClaim = z.infer<typeof ValidationClaimSchema>;

export const GenericCommitRefSchema = z
  .object({
    sha: z.string().min(1).max(200),
    message: z.string().max(500).optional(),
  })
  .strict();
export type GenericCommitRef = z.infer<typeof GenericCommitRefSchema>;

/** M27R §3.5: rollback is advisory metadata only -- never verified, never executed. */
export const RollbackClaimSchema = z
  .object({
    targetRef: z.string().max(200).optional(),
    reasonSummary: z.string().max(GENERIC_MAX_SUMMARY_CHARS).optional(),
    scope: z.string().max(500).optional(),
  })
  .strict();
export type RollbackClaim = z.infer<typeof RollbackClaimSchema>;

/** M27R: reportedCost is deliberately absent -- M26 does not own billing data, matching the Claude adapter's existing convention. */
export const ReportedUsageSchema = z
  .object({
    reportedTokens: z.number().int().min(0).optional(),
    reportedDurationSeconds: z.number().int().min(0).optional(),
  })
  .strict();
export type ReportedUsage = z.infer<typeof ReportedUsageSchema>;

export const ContinuationSchema = z
  .object({
    recommended: z.boolean(),
    reason: z.string().max(GENERIC_MAX_CONTINUATION_REASON_CHARS).optional(),
  })
  .strict();
export type Continuation = z.infer<typeof ContinuationSchema>;

/**
 * M27R §3.5: the vendor-neutral document a human-operated external agent
 * must produce. No raw command output, source code, diff, or arbitrary
 * nested payload -- every field is bounded, structural, and either an
 * opaque reference or a self-reported claim.
 */
export const ExternalExecutionResultSchema = z
  .object({
    protocolVersion: z.literal("aiqt-external-execution-result@1"),
    requestId: z.string().min(1),
    executionSessionId: z.string().min(1),
    agent: ExternalAgentRefSchema,
    resultClass: GenericResultClassSchema,
    summary: z.string().max(GENERIC_MAX_SUMMARY_CHARS),
    continuation: ContinuationSchema,
    validationClaims: z.array(ValidationClaimSchema).max(GENERIC_MAX_VALIDATION_CLAIMS),
    commitRefs: z.array(GenericCommitRefSchema).max(GENERIC_MAX_COMMIT_REFS),
    evidenceRefs: z.array(z.string()).max(GENERIC_MAX_EVIDENCE_REFS),
    rollbackClaim: RollbackClaimSchema.optional(),
    reportedUsage: ReportedUsageSchema.optional(),
  })
  .strict();
export type ExternalExecutionResult = z.infer<typeof ExternalExecutionResultSchema>;
