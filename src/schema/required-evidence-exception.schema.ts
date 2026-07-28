import { z } from "zod";
import { RequiredGateSchema } from "./required-rule-recovery-proof.schema.js";

export const REQUIRED_EVIDENCE_EXCEPTION_PROTOCOL_VERSION = "aiqt-required-evidence-exception@1" as const;
export const MAX_EXCEPTIONS = 500;
export const MAX_EXCEPTION_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const ExceptionUsageModeSchema = z.enum(["single_use", "until_expiry"]);
export type ExceptionUsageMode = z.infer<typeof ExceptionUsageModeSchema>;

export const ExceptionStatusSchema = z.enum(["active", "consumed", "revoked", "expired"]);
export type ExceptionStatus = z.infer<typeof ExceptionStatusSchema>;

export const RequiredEvidenceExceptionSchema = z
  .object({
    protocolVersion: z.literal(REQUIRED_EVIDENCE_EXCEPTION_PROTOCOL_VERSION),
    exceptionId: z.string().min(1),
    activationId: z.string().min(1),
    gate: RequiredGateSchema,
    scope: z
      .object({
        projectId: z.string().min(1),
        workUnitId: z.string().min(1).optional(),
      })
      .strict(),
    policyDigest: Sha256Schema,
    ruleIds: z.array(z.string().min(1)).min(1).max(100),
    authorizedBy: z.string().min(1).max(200),
    reason: z.string().min(1).max(2000),
    createdAt: z.string(),
    expiresAt: z.string(),
    usage: z
      .object({
        mode: ExceptionUsageModeSchema,
        consumedAt: z.string().optional(),
        consumedByDecisionId: z.string().optional(),
      })
      .strict(),
    status: ExceptionStatusSchema,
  })
  .strict();
export type RequiredEvidenceException = z.infer<typeof RequiredEvidenceExceptionSchema>;
