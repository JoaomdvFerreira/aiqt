import type { AutonomousRiskClass } from "../schema/autonomous-run.schema.js";
import { RISK_CLASSES_REQUIRING_APPROVAL, RISK_CLASSES_ALWAYS_BLOCKED } from "../schema/autonomous-run.schema.js";
import { buildContextManifest, type ContextManifestInput } from "./execution-context-manifest.js";
import { buildContinuationCapsule, type BuildContinuationCapsuleInput } from "./execution-continuation.js";
import { classifyValidationCommands } from "./execution-validation-classifier.js";
import {
  EXECUTION_GUIDANCE_PROTOCOL_VERSION,
  type WorkComplexity,
  type ReasoningEffort,
  type AgentClass,
  type RecommendationConfidence,
  type ConcreteAgentRecommendation,
  type ExecutionGuidanceComplexity,
  type ExecutionGuidanceAgent,
  type ExecutionGuidanceContext,
  type ExecutionGuidanceValidation,
  type ExecutionGuidanceOutput,
  type ExecutionGuidanceSubagents,
  type ExecutionGuidance,
  type ExecutionGuidanceProfileConfigPartial,
  type ValidationTier,
} from "../schema/execution-guidance.schema.js";

/**
 * M39-WU01 (build spec Sec 4-8): the single Execution Guidance decision
 * owner. Every function here is pure -- no filesystem, no clock, no
 * provider/billing API, no model call. Packet, preview, prompt, and
 * autonomous surfaces call `composeExecutionGuidance` (or the individual
 * exports below) instead of implementing their own recommendation logic;
 * see repository-owner-map.json's `executionGuidance` entry.
 *
 * This module intentionally does NOT implement the context manifest,
 * continuation-capsule derivation, or adaptive/impacted validation
 * selection -- `composeExecutionGuidance` returns stable, typed
 * placeholders for those (build spec Sec 9: "define, but do not fully
 * implement"). WU39-02/WU39-04 replace the placeholders without changing
 * this file's complexity/agent/validation-default/output/subagent logic.
 */

export interface WorkComplexitySignalsInput {
  objective: string;
  scope: readonly string[];
  outOfScope: readonly string[];
  acceptanceCriteria: readonly string[];
  suggestedFiles: readonly string[];
  dependencies: readonly string[];
  /** M36/M38 candidate risk classification, when this Work Unit is being executed via an autonomous surface. Absent for ordinary human-driven Work Units. */
  autonomousRiskClass?: AutonomousRiskClass | null;
}

/**
 * Bounded, fixed keyword set (build spec Sec 5/7: "explicit risk/security/
 * schema/migration/concurrency/architecture terms"). Deliberately a small,
 * literal, case-insensitive list -- not an LLM classification, not a
 * heuristic that grows without a reviewed change to this file.
 */
const ARCHITECTURAL_TERMS = [
  "architecture",
  "migration",
  "canonical schema",
  "schema version",
  "breaking change",
  "irreversible",
];
const RISK_TERMS = [
  "security",
  "authentication",
  "authorization",
  "credentials",
  "secret",
  "encryption",
  "cryptograph",
  "concurrency",
  "race condition",
  "destructive",
  "migration",
  "schema",
];

function countTermHits(haystack: string, terms: readonly string[]): number {
  const lower = haystack.toLowerCase();
  return terms.reduce((count, term) => (lower.includes(term) ? count + 1 : count), 0);
}

function joinedText(input: WorkComplexitySignalsInput): string {
  return [input.objective, ...input.scope, ...input.outOfScope, ...input.acceptanceCriteria].join(" \n ");
}

/**
 * Deterministic, provider-neutral complexity classification (build spec
 * Sec 7). Identical input always yields identical output: every signal is
 * a bounded count or a fixed-keyword text scan over data already present
 * on the Work Unit/candidate, never a clock, random source, or model call.
 */
export function classifyWorkComplexity(input: WorkComplexitySignalsInput): ExecutionGuidanceComplexity {
  const text = joinedText(input);
  const architecturalHits = countTermHits(text, ARCHITECTURAL_TERMS);
  const riskHits = countTermHits(text, RISK_TERMS);
  const breadth = input.scope.length + input.suggestedFiles.length + input.dependencies.length;
  const acCount = input.acceptanceCriteria.length;
  const blockedByAutonomousRisk = input.autonomousRiskClass != null && RISK_CLASSES_ALWAYS_BLOCKED.has(input.autonomousRiskClass);
  const approvalRequiredByAutonomousRisk = input.autonomousRiskClass != null && RISK_CLASSES_REQUIRING_APPROVAL.has(input.autonomousRiskClass);

  const reasons: string[] = [];
  let value: WorkComplexity;
  let confidence: RecommendationConfidence;

  const noSignals = input.objective.trim().length === 0 && breadth === 0 && acCount === 0;

  if (noSignals) {
    value = "standard";
    confidence = "low";
    reasons.push("No objective, scope, suggested-file, dependency, or acceptance-criteria signal was available; defaulting to standard with low confidence rather than guessing a lower tier.");
  } else if (architecturalHits > 0 || blockedByAutonomousRisk) {
    value = "architectural";
    confidence = architecturalHits > 0 ? "high" : "medium";
    if (architecturalHits > 0) reasons.push(`Matched ${architecturalHits} architectural/migration/schema-version term(s) in objective/scope/acceptance criteria.`);
    if (blockedByAutonomousRisk) reasons.push(`Autonomous safety classification "${input.autonomousRiskClass}" is an always-blocked risk class.`);
  } else if (riskHits > 0 || approvalRequiredByAutonomousRisk || breadth > 8) {
    value = "complex";
    confidence = riskHits > 0 || approvalRequiredByAutonomousRisk ? "high" : "medium";
    if (riskHits > 0) reasons.push(`Matched ${riskHits} explicit risk/security/schema/migration/concurrency term(s).`);
    if (approvalRequiredByAutonomousRisk) reasons.push(`Autonomous safety classification "${input.autonomousRiskClass}" requires human approval.`);
    if (breadth > 8) reasons.push(`Scope+suggested-files+dependency breadth (${breadth}) exceeds the complex threshold (8).`);
  } else if (breadth <= 1 && acCount <= 1) {
    value = "mechanical";
    confidence = "high";
    reasons.push(`Minimal breadth (${breadth}) and at most one acceptance criterion; no risk or architectural terms matched.`);
  } else if (breadth <= 3) {
    value = "simple";
    confidence = breadth <= 2 ? "high" : "medium";
    reasons.push(`Bounded breadth (${breadth}, threshold 3); no risk or architectural terms matched.`);
  } else {
    value = "standard";
    confidence = "medium";
    reasons.push(`Breadth (${breadth}) is above the simple threshold (3) and at/below the complex threshold (8); no risk or architectural terms matched.`);
  }

  return { value, confidence, reasons };
}

/**
 * Default provider-neutral mapping (build spec Sec 5 table). `simple`
 * deliberately resolves to `economy` unless a mild breadth signal (>1
 * suggested file) nudges it to `balanced` -- the spec states
 * "economy/balanced" for `simple` without a fixed tie-breaker, so the
 * tie-break itself is recorded in `reasons` rather than left implicit.
 */
export function recommendAgentClass(
  complexity: WorkComplexity,
  options?: { suggestedFileCount?: number },
): { recommendedClass: AgentClass; reasoningEffort: ReasoningEffort; reasons: string[] } {
  const suggestedFileCount = options?.suggestedFileCount ?? 0;
  switch (complexity) {
    case "mechanical":
      return { recommendedClass: "economy", reasoningEffort: "low", reasons: ["mechanical work defaults to economy/low per the default mapping table."] };
    case "simple": {
      const recommendedClass: AgentClass = suggestedFileCount > 1 ? "balanced" : "economy";
      return {
        recommendedClass,
        reasoningEffort: "low",
        reasons: [`simple work defaults to low reasoning; class tie-break used suggestedFileCount=${suggestedFileCount} (>1 -> balanced, else economy).`],
      };
    }
    case "standard":
      return { recommendedClass: "balanced", reasoningEffort: "medium", reasons: ["standard work defaults to balanced/medium per the default mapping table."] };
    case "complex":
      return { recommendedClass: "strong", reasoningEffort: "high", reasons: ["complex work defaults to strong/high per the default mapping table."] };
    case "architectural":
      return { recommendedClass: "strong", reasoningEffort: "high", reasons: ["architectural work defaults to strong/high per the default mapping table."] };
  }
}

/**
 * Looks up an operator-configured concrete label (build spec Sec 5,
 * "Concrete profiles"). Pure lookup only -- never queries a provider API,
 * never changes an M37/M38 adapter's configured model, and returns `null`
 * (generic guidance only) whenever no matching entry is configured.
 */
export function resolveConcreteRecommendation(
  recommendedClass: AgentClass,
  reasoningEffort: ReasoningEffort,
  profileConfig: ExecutionGuidanceProfileConfigPartial | null | undefined,
): ConcreteAgentRecommendation | null {
  const entry = profileConfig?.agentClassProfiles?.[recommendedClass]?.[reasoningEffort];
  return entry ?? null;
}

export function buildAgentGuidance(
  complexity: WorkComplexity,
  options: { suggestedFileCount?: number; profileConfig?: ExecutionGuidanceProfileConfigPartial | null } = {},
): ExecutionGuidanceAgent {
  const { recommendedClass, reasoningEffort, reasons } = recommendAgentClass(complexity, options);
  const concreteRecommendation = resolveConcreteRecommendation(recommendedClass, reasoningEffort, options.profileConfig);
  return {
    recommendedClass,
    reasoningEffort,
    concreteRecommendation,
    advisory: true,
    reasons: concreteRecommendation
      ? [...reasons, `Configured profile mapping resolved to "${concreteRecommendation.agent}".`]
      : [...reasons, "No configured profile mapping for this class/effort pair; generic guidance only."],
  };
}

/**
 * Stable, deterministic fallback used only when the caller supplies no
 * `contextManifestInput` (build spec Sec 6/9). `composeExecutionGuidance`
 * calls the real `buildContextManifest` (execution-context-manifest.ts,
 * WU39-02) whenever manifest input is provided; this placeholder keeps
 * `ExecutionGuidance.context` populated with a stable, empty-but-typed
 * shape for callers that have not yet been wired to supply real context
 * candidates.
 */
export function buildContextPlaceholder(): ExecutionGuidanceContext {
  return {
    profile: "focused",
    targetEstimatedTokens: null,
    estimatedTokens: null,
    items: [],
    warnings: ["Context manifest selection is not yet implemented (WU39-02); this is a stable placeholder."],
  };
}

export interface ValidationGuidanceInput {
  /** A recorded, human/agent-authored justification for running the full suite at this Work Unit. Absent/empty means no exception was taken. */
  explicitFullSuiteReason?: string | null;
  isMilestoneClosure?: boolean;
  /** This Work Unit's own `validationCommands` (build spec Sec 7, "Existing validation commands"). Omit to keep the WU39-01/02/03 fixed static+focused default unchanged. */
  explicitValidationCommands?: readonly string[];
}

/**
 * Progressive validation defaults (build spec Sec 7). Ordinary Work Units
 * never default to `full`; a Work-Unit-level exception requires a
 * non-empty `explicitFullSuiteReason`, which is then surfaced verbatim in
 * `reasons` rather than silently honored. When `explicitValidationCommands`
 * is supplied (M39-WU04), each command is conservatively classified
 * (execution-validation-classifier.ts) and folded in: static/focused/
 * impacted/unclassified commands are real now-required steps (an unknown
 * scope is never guessed into a lenient tier -- it is required now, not
 * silently deferred); a full/milestone-tier command found in the Work
 * Unit's own plan without `explicitFullSuiteReason` stays deferred but is
 * recorded as a visible reason, never silently absorbed or silently
 * dropped.
 */
export function buildValidationGuidance(input: ValidationGuidanceInput = {}): ExecutionGuidanceValidation {
  const explicitReason = input.explicitFullSuiteReason?.trim() || null;
  const reasons: string[] = [];

  if (input.isMilestoneClosure) {
    reasons.push("Milestone closure always requires milestone + full validation tiers, per milestone-protocol.md Sec 4.");
    return {
      requiredNow: [
        { tier: "milestone", reason: "Milestone closure requires broader affected-domain regression." },
        { tier: "full", reason: "Milestone closure requires the authoritative repository validation suite." },
      ],
      deferred: [],
      fullSuiteRequiredAt: "milestone_closure",
      reasons,
    };
  }

  let requiredNow: ExecutionGuidanceValidation["requiredNow"];
  const deferred: ExecutionGuidanceValidation["deferred"] = [
    { tier: "impacted", reason: "Deferred unless directly justified by cross-cutting blast radius." },
    { tier: "milestone", reason: "Deferred to milestone closure by default." },
    { tier: "full", reason: "Deferred to milestone closure by default; ordinary Work Units must not default to the full suite." },
  ];

  if (input.explicitValidationCommands && input.explicitValidationCommands.length > 0) {
    requiredNow = [];
    const seenNowTiers = new Set<ValidationTier>();
    for (const classified of classifyValidationCommands(input.explicitValidationCommands)) {
      if (classified.tier === "full" || classified.tier === "milestone") {
        reasons.push(`Command "${classified.command}" classifies as ${classified.tier}, but no full-suite-at-Work-Unit reason was recorded; deferred to milestone closure, not silently required or discarded.`);
        continue;
      }
      if (!seenNowTiers.has(classified.tier)) {
        seenNowTiers.add(classified.tier);
        requiredNow.push({
          tier: classified.tier,
          reason:
            classified.tier === "unclassified"
              ? `Command "${classified.command}" has a validation scope that could not be conservatively classified; running as originally specified rather than guessing a safe tier.`
              : `Explicit command from this Work Unit's own validationCommands: "${classified.command}".`,
        });
      }
    }
    if (requiredNow.length === 0) {
      requiredNow.push({ tier: "static", reason: "Structural checks (typecheck/lint/build) run for every Work Unit." });
    }
    // A tier actively required now (e.g. "impacted" justified by its
    // presence in the Work Unit's own plan) must not also appear as a
    // generic deferred placeholder.
    const requiredTiers = new Set(requiredNow.map((step) => step.tier));
    for (let i = deferred.length - 1; i >= 0; i -= 1) {
      if (requiredTiers.has(deferred[i].tier)) deferred.splice(i, 1);
    }
  } else {
    requiredNow = [
      { tier: "static", reason: "Structural checks (typecheck/lint/build) run for every Work Unit." },
      { tier: "focused", reason: "Tests directly covering this Work Unit's changed behavior run for every Work Unit." },
    ];
  }

  if (explicitReason) {
    const fullIndex = deferred.findIndex((step) => step.tier === "full");
    if (fullIndex >= 0) deferred.splice(fullIndex, 1);
    requiredNow.push({ tier: "full", reason: explicitReason });
    reasons.push(`Full-suite-at-Work-Unit exception recorded: ${explicitReason}`);
    return { requiredNow, deferred, fullSuiteRequiredAt: "work_unit", reasons };
  }

  reasons.push("No explicit full-suite exception recorded; full suite deferred to milestone closure per milestone-protocol.md Sec 4.");
  return { requiredNow, deferred, fullSuiteRequiredAt: "milestone_closure", reasons };
}

/** Fixed output policy (build spec Sec 8): never configurable per Work Unit, so this is a constant, not a heuristic. */
export function buildOutputPolicy(): ExecutionGuidanceOutput {
  return { passingCommandDetail: "summary", failureDetail: "full" };
}

/**
 * Default-zero, targeted-only subagent policy (build spec Sec 8/9).
 * `mode`/`maxParallel` structurally cannot represent a recursive swarm --
 * the type only distinguishes `none` from a single bounded `targeted`
 * investigation (`maxParallel` capped at 1).
 */
export function buildSubagentGuidance(
  complexity: WorkComplexity,
  justification?: string | null,
): ExecutionGuidanceSubagents {
  const trimmedJustification = justification?.trim() || null;
  const complexityAllowsTargeted = complexity === "complex" || complexity === "architectural";

  if (complexityAllowsTargeted && trimmedJustification) {
    return { mode: "targeted", maxParallel: 1, reason: trimmedJustification };
  }
  if (complexityAllowsTargeted && !trimmedJustification) {
    return { mode: "none", maxParallel: 0, reason: "Complexity allows a targeted subagent, but no concrete justification was recorded." };
  }
  return { mode: "none", maxParallel: 0, reason: `${complexity} Work Units default to zero subagents.` };
}

export interface ComposeExecutionGuidanceInput {
  workUnitId: string;
  workUnit: WorkComplexitySignalsInput;
  profileConfig?: ExecutionGuidanceProfileConfigPartial | null;
  explicitFullSuiteReason?: string | null;
  isMilestoneClosure?: boolean;
  subagentJustification?: string | null;
  /** Real context-candidate input (WU39-02). Omit to keep the stable placeholder (WU39-01 behavior) for callers not yet wired to supply it. */
  contextManifestInput?: Omit<ContextManifestInput, "workUnitId" | "complexity"> | null;
  /** Real continuation-capsule input (WU39-02). Omit to keep `continuation: null` (WU39-01 behavior) for callers not yet wired to supply it. */
  continuationInput?: BuildContinuationCapsuleInput | null;
  /** This Work Unit's own `validationCommands` (WU39-04). Omit to keep the WU39-01/02/03 fixed static+focused default. */
  explicitValidationCommands?: readonly string[];
}

/**
 * The single composition entry point every consumer should call. Pure and
 * deterministic: identical `input` always produces an identical
 * `ExecutionGuidance` (field order and content), since every step it
 * delegates to is itself pure.
 */
export function composeExecutionGuidance(input: ComposeExecutionGuidanceInput): ExecutionGuidance {
  const complexity = classifyWorkComplexity(input.workUnit);
  const agent = buildAgentGuidance(complexity.value, {
    suggestedFileCount: input.workUnit.suggestedFiles.length,
    profileConfig: input.profileConfig,
  });
  const context = input.contextManifestInput
    ? buildContextManifest({ ...input.contextManifestInput, workUnitId: input.workUnitId, complexity: complexity.value })
    : buildContextPlaceholder();
  const continuation = input.continuationInput ? buildContinuationCapsule(input.continuationInput) : null;

  return {
    version: EXECUTION_GUIDANCE_PROTOCOL_VERSION,
    workUnitId: input.workUnitId,
    complexity,
    agent,
    context,
    continuation,
    validation: buildValidationGuidance({
      explicitFullSuiteReason: input.explicitFullSuiteReason,
      isMilestoneClosure: input.isMilestoneClosure,
      explicitValidationCommands: input.explicitValidationCommands,
    }),
    output: buildOutputPolicy(),
    subagents: buildSubagentGuidance(complexity.value, input.subagentJustification),
  };
}
