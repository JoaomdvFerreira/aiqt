import { z } from "zod";

export const REQUIRED_MODE_ACTIVATION_PLAN_PROTOCOL_VERSION = "aiqt-required-mode-activation-plan@1" as const;
export const MAX_ACTIVATION_PLANS = 5;
export const ACTIVATION_PLAN_EXPIRY_SECONDS = 24 * 60 * 60;
export const ACTIVATION_RESIDUAL_RISK_MAXIMUM_FOR_ACTIVATION = 5;

/**
 * M30 §4.6.1: fixed, non-configurable per-condition weights. Protocol
 * constants of `aiqt-required-mode-activation-plan@1` -- no profile field,
 * CLI argument, or user-supplied number can override these.
 */
export const GATE_K_CONDITION_WEIGHTS = {
  profileAndPolicyDigestsVerified: 15,
  explicitHumanActivationInputsComplete: 12,
  requiredAdvisoryPeriodComplete: 10,
  acceptedFalsePositiveRateSatisfied: 8,
  everyRequiredRuleObserved: 10,
  everyRequiredRuleRecoveryProofValid: 15,
  amendmentCompositionProven: 15,
  readinessCompositionProven: 15,
  advisoryRunlogHistoryComplete: 12,
  unavailableObservationsZero: 10,
  unresolvedDeadlockFindingsZero: 15,
  activationSnapshotCurrentAndUnexpired: 15,
} as const;
export type GateKConditionKey = keyof typeof GATE_K_CONDITION_WEIGHTS;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const ActivationMetricsSchema = z
  .object({
    advisoryObservations: z.number().int().min(0),
    classifiedFindings: z.number().int().min(0),
    falsePositiveRate: z.number().min(0).max(1).nullable(),
    runlogHistoryComplete: z.boolean(),
    unavailableObservations: z.number().int().min(0),
    rulesObserved: z.number().int().min(0),
    rulesRequired: z.number().int().min(0),
    recoveryProofsValid: z.number().int().min(0),
    recoveryProofsRequired: z.number().int().min(0),
  })
  .strict();
export type ActivationMetrics = z.infer<typeof ActivationMetricsSchema>;

export const RequiredModeActivationPlanSchema = z
  .object({
    protocolVersion: z.literal(REQUIRED_MODE_ACTIVATION_PLAN_PROTOCOL_VERSION),
    planId: z.string().min(1),
    profileRef: z.object({ profileId: z.string().min(1), version: z.number().int().positive() }).strict(),
    generatedAt: z.string(),
    expiresAt: z.string(),
    activationSnapshotDigest: Sha256Schema,
    grandfatheredWorkUnitIds: z.array(z.string().min(1)).max(10000),
    metrics: ActivationMetricsSchema,
    blockers: z.array(z.string().min(1)).max(50),
    projectActivationResidualRisk: z.number().int().min(0).max(100),
  })
  .strict();
export type RequiredModeActivationPlan = z.infer<typeof RequiredModeActivationPlanSchema>;
