import { z } from "zod";

/**
 * M30 §4.1: bounded profile/limits. Not increased without review, mirroring
 * every prior milestone's limits convention (M28's MAX_POLICIES etc.).
 */
export const MAX_ENFORCEMENT_PROFILES = 25;
export const MAX_VERSIONS_PER_ENFORCEMENT_PROFILE = 10;
export const MAX_ENFORCEMENT_PROFILE_BYTES = 262144;

export const EVIDENCE_ENFORCEMENT_PROFILE_PROTOCOL_VERSION = "aiqt-evidence-enforcement-profile@1" as const;

/** Same bounded namespaced identifier convention as M28's PolicyIdSchema. */
export const ProfileIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/);

const PolicyRefSchema = z
  .object({
    policyId: z.string().min(1),
    version: z.number().int().positive(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type EnforcementPolicyRef = z.infer<typeof PolicyRefSchema>;

/** M30 §4.2: accepted providers are bounded canonical provider IDs -- data only, never executable adapters. Provider acceptance does not imply trust. */
const AcceptedProvidersSchema = z.array(z.string().min(1).max(200)).max(100).optional();

const BindingRequirementSchema = z.enum(["optional", "required"]);

const BindingRequirementsSchema = z
  .object({
    workUnit: z.literal("required"),
    packet: BindingRequirementSchema.optional(),
    implementationRoot: BindingRequirementSchema.optional(),
    codeState: BindingRequirementSchema.optional(),
  })
  .strict();
export type BindingRequirements = z.infer<typeof BindingRequirementsSchema>;

const FailBehaviorSchema = z.enum(["needs_review", "block"]);
const ReviewFailBehaviorSchema = z.enum(["fail_review", "warn"]);

export const CheckpointGateProfileSchema = z
  .object({
    policyRef: PolicyRefSchema,
    acceptedProviders: AcceptedProvidersSchema,
    bindingRequirements: BindingRequirementsSchema,
    onFail: z.literal("needs_review"),
    onIndeterminate: FailBehaviorSchema,
    onUnavailable: FailBehaviorSchema,
    exceptionEligibleRuleIds: z.array(z.string().min(1)).max(200),
  })
  .strict();
export type CheckpointGateProfile = z.infer<typeof CheckpointGateProfileSchema>;

export const ReviewTargetSchema = z.enum(["project", "effective_done_work_units", "effective_checkpoints"]);
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>;

export const ReviewGateProfileSchema = z
  .object({
    policyRef: PolicyRefSchema,
    targetSet: z.array(ReviewTargetSchema).min(1).max(3),
    acceptedProviders: AcceptedProvidersSchema,
    bindingRequirements: BindingRequirementsSchema.omit({ workUnit: true }).extend({
      workUnit: BindingRequirementSchema.optional(),
    }),
    onIndeterminate: ReviewFailBehaviorSchema,
    onUnavailable: ReviewFailBehaviorSchema,
    exceptionEligibleRuleIds: z.array(z.string().min(1)).max(200),
  })
  .strict();
export type ReviewGateProfile = z.infer<typeof ReviewGateProfileSchema>;

export const ActivationRequirementProfileSchema = z
  .object({
    minimumAdvisoryObservations: z.number().int().min(3).max(100),
    minimumClassifiedFindings: z.number().int().min(0).max(100),
    maximumAcceptedFalsePositiveRate: z.number().min(0).max(1),
    requireCompleteAdvisoryHistory: z.literal(true),
    requireEveryRuleObserved: z.literal(true),
    requireEveryRuleRecoveryProof: z.literal(true),
    requireNoUnavailableObservation: z.literal(true),
    requireNoOpenDeadlockFinding: z.literal(true),
  })
  .strict();
export type ActivationRequirementProfile = z.infer<typeof ActivationRequirementProfileSchema>;

const EvidenceEnforcementProfileShape = {
  protocolVersion: z.literal(EVIDENCE_ENFORCEMENT_PROFILE_PROTOCOL_VERSION),
  profileId: ProfileIdSchema,
  version: z.number().int().positive(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  gates: z
    .object({
      checkpoint: CheckpointGateProfileSchema.optional(),
      developmentReview: ReviewGateProfileSchema.optional(),
      releaseReview: ReviewGateProfileSchema.optional(),
    })
    .strict(),
  activationRequirements: ActivationRequirementProfileSchema,
  supersedesVersion: z.number().int().positive().optional(),
};

function checkProfileInvariants(value: { profileId: string; version: number }, ctx: z.RefinementCtx): void {
  if (JSON.stringify(value).length > MAX_ENFORCEMENT_PROFILE_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `EvidenceEnforcementProfile exceeds max_profile_bytes (${MAX_ENFORCEMENT_PROFILE_BYTES})`,
    });
  }
}

/** Canonical, persisted shape -- requires profileDigest/createdAt (AIQT-computed, never caller-supplied). */
export const EvidenceEnforcementProfileSchema = z
  .object({ ...EvidenceEnforcementProfileShape, profileDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), createdAt: z.string() })
  .strict()
  .superRefine(checkProfileInvariants);
export type EvidenceEnforcementProfile = z.infer<typeof EvidenceEnforcementProfileSchema>;

/** Import-time input shape -- omits AIQT-computed fields, mirroring M28's EvidenceGatePolicyInputSchema pattern. */
export const EvidenceEnforcementProfileInputSchema = z
  .object(EvidenceEnforcementProfileShape)
  .strict()
  .superRefine(checkProfileInvariants);
export type EvidenceEnforcementProfileInput = z.infer<typeof EvidenceEnforcementProfileInputSchema>;
