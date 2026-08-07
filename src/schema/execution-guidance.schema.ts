import { z } from "zod";

/**
 * M39-WU01 (build spec Sec 4): the shared, provider-neutral Execution
 * Guidance contract. This is the single logical shape every M39 consumer
 * (preview, packet rendering, prompt driver, autonomous surfaces) must
 * read from -- no consumer computes its own recommendation logic. The
 * enums below are zod schemas (used to validate the one piece of this
 * contract that is genuinely external input: an operator-supplied concrete
 * profile-mapping config file); the composite result shapes are plain TS
 * interfaces, matching the convention used by other pure decision engines
 * in this repository (e.g. autonomous-run-safety-classifier.ts) -- they are
 * a computed *output*, never parsed from outside input, so there is
 * nothing for a zod schema to validate.
 */
export const EXECUTION_GUIDANCE_PROTOCOL_VERSION = "execution-guidance@1" as const;

export const WorkComplexitySchema = z.enum(["mechanical", "simple", "standard", "complex", "architectural"]);
export type WorkComplexity = z.infer<typeof WorkComplexitySchema>;

export const ReasoningEffortSchema = z.enum(["low", "medium", "high"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const AgentClassSchema = z.enum(["economy", "balanced", "strong"]);
export type AgentClass = z.infer<typeof AgentClassSchema>;

export const ContextProfileSchema = z.enum(["minimal", "focused", "expanded"]);
export type ContextProfile = z.infer<typeof ContextProfileSchema>;

export const ContextPrioritySchema = z.enum(["must_read", "should_read", "reference_only"]);
export type ContextPriority = z.infer<typeof ContextPrioritySchema>;

export const ValidationTierSchema = z.enum(["static", "focused", "impacted", "milestone", "full", "unclassified"]);
export type ValidationTier = z.infer<typeof ValidationTierSchema>;

export const RecommendationConfidenceSchema = z.enum(["low", "medium", "high"]);
export type RecommendationConfidence = z.infer<typeof RecommendationConfidenceSchema>;

export const FullSuiteRequiredAtSchema = z.enum(["work_unit", "milestone_closure", "release"]);
export type FullSuiteRequiredAt = z.infer<typeof FullSuiteRequiredAtSchema>;

export const SubagentModeSchema = z.enum(["none", "targeted"]);
export type SubagentMode = z.infer<typeof SubagentModeSchema>;

/** M39 build spec Sec 4/6: a single context item reference, never embedded file content. */
export interface ContextItem {
  path: string;
  priority: ContextPriority;
  reason: string;
}

export interface ExecutionGuidanceContext {
  profile: ContextProfile;
  /** Provider-neutral heuristic estimate, never a real provider token count. */
  targetEstimatedTokens: number | null;
  estimatedTokens: number | null;
  items: ContextItem[];
  warnings: string[];
}

/** M39 build spec Sec 6: compact, canonical-evidence-derived continuation. Absent (`null`) until WU39-02 implements real derivation. */
export interface ContinuationCapsule {
  previousCheckpointSummary: string | null;
  filesChangedByDependencies: string[];
  dependencyValidationResult: string | null;
  unresolvedIssueTitles: string[];
  carryForwardRefs: string[];
}

export interface ValidationStep {
  tier: ValidationTier;
  reason: string;
}

export interface ExecutionGuidanceValidation {
  requiredNow: ValidationStep[];
  deferred: ValidationStep[];
  fullSuiteRequiredAt: FullSuiteRequiredAt;
  reasons: string[];
}

export interface ExecutionGuidanceOutput {
  passingCommandDetail: "summary";
  failureDetail: "full";
}

export interface ExecutionGuidanceSubagents {
  mode: SubagentMode;
  maxParallel: number;
  reason: string;
}

export interface ConcreteAgentRecommendation {
  agent: string;
  model: string | null;
  effort: string | null;
}

export interface ExecutionGuidanceAgent {
  recommendedClass: AgentClass;
  reasoningEffort: ReasoningEffort;
  concreteRecommendation: ConcreteAgentRecommendation | null;
  advisory: true;
  reasons: string[];
}

export interface ExecutionGuidanceComplexity {
  value: WorkComplexity;
  confidence: RecommendationConfidence;
  reasons: string[];
}

export interface ExecutionGuidance {
  version: typeof EXECUTION_GUIDANCE_PROTOCOL_VERSION;
  workUnitId: string;
  complexity: ExecutionGuidanceComplexity;
  agent: ExecutionGuidanceAgent;
  context: ExecutionGuidanceContext;
  continuation: ContinuationCapsule | null;
  validation: ExecutionGuidanceValidation;
  output: ExecutionGuidanceOutput;
  subagents: ExecutionGuidanceSubagents;
}

/**
 * Operator-configured, provider-neutral -> concrete label mapping (build
 * spec Sec 5, "Concrete profiles"). This is configuration, never a
 * hardcoded model inventory: an operator opts in by writing this file; a
 * missing file or missing entry always falls back to generic class/effort
 * guidance (`concreteRecommendation: null`), never a guessed default.
 * Deliberately a *narrow, additive* config surface distinct from
 * `AutonomousOperatorConfigSchema` (M37) -- that schema governs autonomous
 * execution safety/budget policy, not everyday Work Unit agent-profile
 * labeling, and its `.strict()` object must not grow unrelated fields.
 */
const ConcreteAgentRecommendationSchema = z
  .object({
    agent: z.string().min(1),
    model: z.string().min(1).nullable(),
    effort: z.string().min(1).nullable(),
  })
  .strict();

const ReasoningEffortProfileMapSchema = z
  .object({
    low: ConcreteAgentRecommendationSchema.optional(),
    medium: ConcreteAgentRecommendationSchema.optional(),
    high: ConcreteAgentRecommendationSchema.optional(),
  })
  .strict();

export const ExecutionGuidanceProfileConfigSchema = z
  .object({
    agentClassProfiles: z
      .object({
        economy: ReasoningEffortProfileMapSchema.optional(),
        balanced: ReasoningEffortProfileMapSchema.optional(),
        strong: ReasoningEffortProfileMapSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type ExecutionGuidanceProfileConfig = z.infer<typeof ExecutionGuidanceProfileConfigSchema>;

/** Any subset of fields -- a project config file may configure only some class/effort pairs. */
export const ExecutionGuidanceProfileConfigPartialSchema = ExecutionGuidanceProfileConfigSchema.partial();
export type ExecutionGuidanceProfileConfigPartial = z.infer<typeof ExecutionGuidanceProfileConfigPartialSchema>;
