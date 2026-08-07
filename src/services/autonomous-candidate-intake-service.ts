import { AutonomousCandidateSchema, type AutonomousCandidate, type AutonomousSafetyAssessment, type ProhibitedAreaTag } from "../schema/autonomous-run.schema.js";
import { classifyCandidate, isAlwaysBlocked, requiresApproval } from "../workflow/autonomous-run-safety-classifier.js";
import { runRepositoryPreflight, type RepositoryPreflightResult } from "../workflow/autonomous-run-preflight.js";
import { classifyWorkComplexity, recommendAgentClass } from "../workflow/execution-guidance.js";
import type { WorkComplexity, ReasoningEffort, AgentClass, RecommendationConfidence } from "../schema/execution-guidance.schema.js";

/**
 * M36-WU02 (build spec Sec "Scope": "candidate intake; issue
 * normalization; ... dry-run classification output"). The single entry
 * point that turns one raw candidate payload into a validated
 * AutonomousCandidate, runs real (read-only) repository preflight
 * against it, and returns a deterministic safety classification --
 * without creating a workspace, executing a repair command, or
 * requiring anything beyond what WU36-01's contract and this file's own
 * preflight already established. "One issue per run" (build spec Sec
 * 6.1/Cross-Work-Unit Invariant 3) is enforced structurally: this
 * function's signature accepts exactly one candidate value, never an
 * array or batch -- there is no other intake entry point in this
 * module, and none is planned (see tests/unit/autonomous-run-boundary-
 * scan.test.ts's WU36-02 addendum for the guard proving this).
 */
export interface IntakeCandidateInput {
  /** Unvalidated input -- may be malformed, which is itself a normal, fail-closed outcome (see IntakeCandidateResult.ok: false). */
  rawCandidate: unknown;
  repositoryPath: string;
  validationCommandsAvailable: boolean;
  prohibitedAreaTags: readonly ProhibitedAreaTag[];
}

export interface IntakeCandidateSuccess {
  ok: true;
  candidate: AutonomousCandidate;
  preflight: RepositoryPreflightResult;
  safetyAssessment: AutonomousSafetyAssessment;
}

export interface IntakeCandidateFailure {
  ok: false;
  reason: "invalid_candidate_shape";
  issues: string[];
}

export type IntakeCandidateResult = IntakeCandidateSuccess | IntakeCandidateFailure;

/**
 * Normalizes and classifies exactly one candidate. Never creates a
 * workspace, never writes a file, never executes a repair command --
 * the only side effect anywhere in this call graph is
 * runRepositoryPreflight's read-only Git inspection. A malformed
 * `rawCandidate` fails closed (`ok: false`) rather than throwing or
 * defaulting to a permissive shape.
 */
export function intakeCandidate(input: IntakeCandidateInput): IntakeCandidateResult {
  const parsed = AutonomousCandidateSchema.safeParse(input.rawCandidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_candidate_shape",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const candidate = parsed.data;

  const preflight = runRepositoryPreflight(input.repositoryPath, candidate.baseRef);

  const safetyAssessment = classifyCandidate({
    candidate,
    repositoryDirty: preflight.repositoryDirty,
    baseRefResolvable: preflight.baseRefResolvable,
    validationCommandsAvailable: input.validationCommandsAvailable,
    prohibitedAreaTags: input.prohibitedAreaTags,
  });

  return { ok: true, candidate, preflight, safetyAssessment };
}

/**
 * M39-HF02 (build spec Sec 9, "Prompt/autonomous integration": "Where
 * M37/M38 already expose an equivalent bounded task, reuse the same
 * decision service without weakening sandbox, approval, command,
 * network, or resource policy"). Purely advisory: complexity/reasoning/
 * agent-class only, reusing the exact same
 * classifyWorkComplexity/recommendAgentClass functions the WU39
 * decision owner already exports -- no second decision owner, no new
 * classification logic. `AutonomousCandidate` has no scope/
 * suggestedFiles/dependencies/validationCommands (unlike a WorkUnit), so
 * only objective/acceptanceCriteria and the already-computed
 * `riskClass` feed the classification; a full `ExecutionGuidance` object
 * (context manifest, continuation, validation tiers) does not apply to
 * an issue-shaped candidate and is deliberately not forced here.
 */
export interface CandidateExecutionGuidanceSummary {
  complexity: WorkComplexity;
  confidence: RecommendationConfidence;
  reasoningEffort: ReasoningEffort;
  recommendedClass: AgentClass;
}

function buildCandidateExecutionGuidanceSummary(candidate: AutonomousCandidate, riskClass: AutonomousSafetyAssessment["riskClass"]): CandidateExecutionGuidanceSummary {
  const complexity = classifyWorkComplexity({
    objective: candidate.objective,
    scope: [],
    outOfScope: [],
    acceptanceCriteria: candidate.acceptanceCriteria,
    suggestedFiles: [],
    dependencies: [],
    autonomousRiskClass: riskClass,
  });
  const { recommendedClass, reasoningEffort } = recommendAgentClass(complexity.value);
  return { complexity: complexity.value, confidence: complexity.confidence, reasoningEffort, recommendedClass };
}

/**
 * A stable, JSON-serializable summary of an intake result -- the "dry-
 * run classification output" the build spec names. Never includes a
 * recommendation to proceed past classification; that decision belongs
 * to a future Work Unit's approval-gate wiring, not this one. The
 * `executionGuidance` field is advisory-only and never influences
 * `riskClass`/`canProceedWithoutApproval`/`requiresApproval`/
 * `alwaysBlocked` -- those are computed exactly as before, from
 * `classifyCandidate`'s own safety assessment alone.
 */
export interface DryRunClassificationReport {
  issueId: string | null;
  riskClass: string | null;
  canProceedWithoutApproval: boolean | null;
  requiresApproval: boolean | null;
  alwaysBlocked: boolean | null;
  reason: string;
  executionGuidance: CandidateExecutionGuidanceSummary | null;
}

export function buildDryRunClassificationReport(result: IntakeCandidateResult): DryRunClassificationReport {
  if (!result.ok) {
    return {
      issueId: null,
      riskClass: null,
      canProceedWithoutApproval: null,
      requiresApproval: null,
      alwaysBlocked: null,
      reason: `Candidate rejected at intake: ${result.issues.join("; ")}`,
      executionGuidance: null,
    };
  }
  const { riskClass, reason } = result.safetyAssessment;
  const alwaysBlocked = isAlwaysBlocked(riskClass);
  const needsApproval = requiresApproval(riskClass);
  return {
    issueId: result.candidate.issueId,
    riskClass,
    canProceedWithoutApproval: !alwaysBlocked && !needsApproval,
    requiresApproval: needsApproval,
    alwaysBlocked,
    reason,
    executionGuidance: buildCandidateExecutionGuidanceSummary(result.candidate, riskClass),
  };
}
