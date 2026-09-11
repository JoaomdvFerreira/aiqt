import { z } from "zod";
import { ArtifactKindSchema, TrustLevelSchema } from "./evidence.schema.js";

/**
 * M28 §3.3: bounded policy/rule/configuration limits. Not increased
 * without review, mirroring every prior milestone's limits convention.
 */
export const MAX_POLICIES = 50;
export const MAX_VERSIONS_PER_POLICY = 20;
export const MAX_RULES_PER_POLICY = 100;
export const MAX_POLICY_BYTES = 262144;
export const MAX_ARTIFACT_KINDS_PER_RULE = 20;
export const MAX_TITLE_CHARS = 200;
export const MAX_DESCRIPTION_CHARS = 2000;
export const MAX_AGE_SECONDS = 31536000;
export const MIN_REQUIRED_COUNT = 1;
export const MAX_REQUIRED_COUNT = 100;

export const EVIDENCE_GATE_POLICY_PROTOCOL_VERSION = "aiqt-evidence-gate-policy@1" as const;

/** M28 §3.1: same syntax family as every other bounded namespaced identifier in this codebase (provider IDs, adapter IDs). */
export const PolicyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/);

export const TargetScopeSchema = z.enum(["project", "work_unit", "checkpoint"]);
export type TargetScope = z.infer<typeof TargetScopeSchema>;

export const ScopeMatchModeSchema = z.enum(["exact_target", "target_or_project"]);
export type ScopeMatchMode = z.infer<typeof ScopeMatchModeSchema>;

export const MissingDispositionSchema = z.enum(["fail", "indeterminate"]);
export type MissingDisposition = z.infer<typeof MissingDispositionSchema>;

/** Presence is the historical/default contract.  A policy opts in to
 * successful-verification semantics explicitly, rather than making every
 * artifact reference imply a PASS. */
export const OutcomeRequirementSchema = z.enum(["presence", "validation_passed"]);
export type OutcomeRequirement = z.infer<typeof OutcomeRequirementSchema>;

/**
 * M28 §3.2: a fixed, declarative selector -- no script, expression, path
 * query, regex, or template exists anywhere in this shape.
 */
export const EvidenceSelectorSchema = z
  .object({
    artifactKinds: z.array(ArtifactKindSchema).min(1).max(MAX_ARTIFACT_KINDS_PER_RULE),
    minimumTrust: TrustLevelSchema,
    scopeMatch: ScopeMatchModeSchema,
    maxAgeSeconds: z.number().int().positive().max(MAX_AGE_SECONDS).optional(),
    outcomeRequirement: OutcomeRequirementSchema.optional(),
  })
  .strict();
export type EvidenceSelector = z.infer<typeof EvidenceSelectorSchema>;

export const RuleRequirementSchema = z
  .object({
    minimumCount: z.number().int().min(MIN_REQUIRED_COUNT).max(MAX_REQUIRED_COUNT),
  })
  .strict();
export type RuleRequirement = z.infer<typeof RuleRequirementSchema>;

export const EvidenceGateRuleSchema = z
  .object({
    ruleId: z.string().min(1).max(200),
    title: z.string().min(1).max(MAX_TITLE_CHARS),
    description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
    appliesTo: z.array(TargetScopeSchema).min(1).max(3),
    evidenceSelector: EvidenceSelectorSchema,
    requirement: RuleRequirementSchema,
    missingDisposition: MissingDispositionSchema,
  })
  .strict();
export type EvidenceGateRule = z.infer<typeof EvidenceGateRuleSchema>;

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * M28 §3.1: `(policyId, version)` is immutable once persisted; a new
 * version must exceed every prior version for that policy id. No
 * mutation ever alters an existing version's rules/digest -- only
 * `activePolicyRef` (a separate configuration pointer) changes.
 */
const EvidenceGatePolicyShape = z.object({
  protocolVersion: z.literal(EVIDENCE_GATE_POLICY_PROTOCOL_VERSION),
  policyId: PolicyIdSchema,
  version: z.number().int().positive(),
  name: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  targetScopes: z.array(TargetScopeSchema).min(1).max(3),
  rules: z.array(EvidenceGateRuleSchema).min(1).max(MAX_RULES_PER_POLICY),
  policyDigest: Sha256DigestSchema,
  createdAt: z.string(),
  supersedesVersion: z.number().int().positive().optional(),
});

function checkPolicyInvariants(value: { rules: readonly { ruleId: string }[] }, ctx: z.RefinementCtx): void {
  const ruleIds = new Set<string>();
  for (const [i, rule] of value.rules.entries()) {
    if (ruleIds.has(rule.ruleId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ruleId "${rule.ruleId}" within one policy version`, path: ["rules", i, "ruleId"] });
    }
    ruleIds.add(rule.ruleId);
  }
  if (JSON.stringify(value).length > MAX_POLICY_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `EvidenceGatePolicy exceeds max_policy_bytes (${MAX_POLICY_BYTES})` });
  }
}

/** M28 §3.1: the canonical, persisted form (policyDigest/createdAt are AIQT-computed, never user-supplied). */
export const EvidenceGatePolicySchema = EvidenceGatePolicyShape.strict().superRefine(checkPolicyInvariants);
export type EvidenceGatePolicy = z.infer<typeof EvidenceGatePolicySchema>;

/** M28 §4.2: the import-time input shape -- omits the two AIQT-computed fields (policyDigest, createdAt). */
export const EvidenceGatePolicyInputSchema = EvidenceGatePolicyShape.omit({ policyDigest: true, createdAt: true })
  .strict()
  .superRefine(checkPolicyInvariants);
export type EvidenceGatePolicyInput = z.infer<typeof EvidenceGatePolicyInputSchema>;

export const ActivePolicyRefSchema = z
  .object({
    policyId: PolicyIdSchema,
    version: z.number().int().positive(),
  })
  .strict();
export type ActivePolicyRef = z.infer<typeof ActivePolicyRefSchema>;

/**
 * M28 §3: additive, optional state section -- the same pattern as
 * `state.executionSessions`/`state.workspace`/`state.evidence`. Missing
 * entirely on pre-M28 state files; never materialized by a read-only
 * command.
 */
export const EvidenceGateConfigurationSchema = z
  .object({
    policies: z.array(EvidenceGatePolicySchema).max(MAX_POLICIES * MAX_VERSIONS_PER_POLICY),
    activePolicyRef: ActivePolicyRefSchema.optional(),
  })
  .strict();
export type EvidenceGateConfiguration = z.infer<typeof EvidenceGateConfigurationSchema>;
