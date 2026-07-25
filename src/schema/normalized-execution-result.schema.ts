import { z } from "zod";
import { ExternalAgentRefSchema } from "./external-agent-ref.schema.js";
import { AdapterIdSchema } from "./adapter-registry.js";
import {
  GenericResultClassSchema,
  ContinuationSchema,
  ValidationClaimSchema,
  GenericCommitRefSchema,
  RollbackClaimSchema,
  ReportedUsageSchema,
} from "./external-execution-result.schema.js";
import {
  GENERIC_MAX_SUMMARY_CHARS,
  GENERIC_MAX_VALIDATION_CLAIMS,
  GENERIC_MAX_COMMIT_REFS,
  GENERIC_MAX_EVIDENCE_REFS,
} from "./adapter-registry.js";

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * M27R §3.6: the ONE internal shape every adapter must terminate at.
 * Native adapters (e.g. the Claude adapter) translate their own
 * provider-specific output into this shape and then hand off to the
 * single shared generic-result application service
 * (src/workflow/generic-result-application-service.ts) -- they never
 * write M26 state directly.
 */
export const NormalizedExternalExecutionResultSchema = z
  .object({
    protocolVersion: z.literal("aiqt-normalized-execution-result@1"),
    adapterId: AdapterIdSchema,
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
    sourceDigest: Sha256DigestSchema,
  })
  .strict();
export type NormalizedExternalExecutionResult = z.infer<typeof NormalizedExternalExecutionResultSchema>;
