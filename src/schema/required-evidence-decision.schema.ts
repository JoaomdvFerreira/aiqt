import { z } from "zod";
import { RequiredGateSchema } from "./required-rule-recovery-proof.schema.js";

export const REQUIRED_EVIDENCE_DECISION_PROTOCOL_VERSION = "aiqt-required-evidence-decision@1" as const;

export const RequiredDecisionOutcomeSchema = z.enum(["allow", "needs_review", "blocked", "invalid"]);
export type RequiredDecisionOutcome = z.infer<typeof RequiredDecisionOutcomeSchema>;

export const RequiredDeficiencySchema = z.enum([
  "none",
  "failed",
  "indeterminate",
  "unavailable",
  "missing",
  "insufficient_trust",
  "stale",
  "provider_not_accepted",
  "binding_mismatch",
  "invalid_reference",
]);
export type RequiredDeficiency = z.infer<typeof RequiredDeficiencySchema>;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * M30 §6.1: the sole output of evaluateRequiredEvidenceGate. Bounded --
 * no raw evidence, simulation report, provider payload, token, log,
 * command output, or source content is persisted.
 */
export const RequiredEvidenceDecisionSchema = z
  .object({
    protocolVersion: z.literal(REQUIRED_EVIDENCE_DECISION_PROTOCOL_VERSION),
    decisionId: z.string().min(1),
    activationId: z.string().min(1),
    profileRef: z.object({ profileId: z.string().min(1), version: z.number().int().positive() }).strict(),
    gate: RequiredGateSchema,
    targetRefs: z.array(z.string().min(1)).max(1000),
    asOf: z.string(),
    outcome: RequiredDecisionOutcomeSchema,
    deficiency: RequiredDeficiencySchema,
    simulationDigests: z.array(Sha256Schema).max(1000),
    exceptionRefs: z.array(z.string().min(1)).max(100),
    blockingRuleRefs: z.array(z.string().min(1)).max(1000),
    summary: z.string().max(2000),
    recovery: z.object({ commands: z.array(z.string().min(1)).max(20) }).strict(),
    recordedAt: z.string(),
  })
  .strict();
export type RequiredEvidenceDecision = z.infer<typeof RequiredEvidenceDecisionSchema>;
