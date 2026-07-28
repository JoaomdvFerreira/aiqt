import { z } from "zod";

export const REQUIRED_RULE_RECOVERY_PROOF_PROTOCOL_VERSION = "aiqt-required-rule-recovery-proof@1" as const;
export const MAX_RECOVERY_PROOFS = 500;

export const RequiredGateSchema = z.enum(["checkpoint", "development_review", "release_review"]);
export type RequiredGate = z.infer<typeof RequiredGateSchema>;

export const RecoveryKindSchema = z.enum([
  "evidence_import",
  "checkpoint_amendment",
  "evidence_replacement",
  "scoped_exception",
]);
export type RecoveryKind = z.infer<typeof RecoveryKindSchema>;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * M30 §4.5: proof metadata and digests only -- AIQT verifies the two
 * imported M28 simulation reports at import time (protocol, canonical
 * digests, same policy/rule/target/asOf, before fail-or-indeterminate,
 * after pass) and persists only this bounded record. No raw simulation
 * report is ever stored.
 */
export const RequiredRuleRecoveryProofSchema = z
  .object({
    protocolVersion: z.literal(REQUIRED_RULE_RECOVERY_PROOF_PROTOCOL_VERSION),
    proofId: z.string().min(1),
    profileRef: z.object({ profileId: z.string().min(1), version: z.number().int().positive() }).strict(),
    gate: RequiredGateSchema,
    policyDigest: Sha256Schema,
    ruleId: z.string().min(1),
    targetRef: z.object({ type: z.enum(["project", "work_unit", "checkpoint"]), id: z.string().min(1) }).strict(),
    recoveryKind: RecoveryKindSchema,
    beforeSimulationDigest: Sha256Schema,
    afterSimulationDigest: Sha256Schema,
    beforeResult: z.enum(["fail", "indeterminate"]),
    afterResult: z.literal("pass"),
    verifiedAt: z.string(),
    proofDigest: Sha256Schema,
  })
  .strict();
export type RequiredRuleRecoveryProof = z.infer<typeof RequiredRuleRecoveryProofSchema>;
