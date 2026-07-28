import type { StateModel } from "../schema/state.schema.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { EvidenceGatePolicy } from "../schema/evidence-gate-policy.schema.js";
import type { CheckpointGateProfile, ReviewGateProfile } from "../schema/evidence-enforcement-profile.schema.js";
import type { SimulationTarget, EvidenceGateSimulation, EvidenceGateRuleResult } from "../schema/evidence-gate-simulation.schema.js";
import type { RequiredDecisionOutcome, RequiredDeficiency } from "../schema/required-evidence-decision.schema.js";
import type { RequiredGate } from "../schema/required-rule-recovery-proof.schema.js";
import type { RequiredEvidenceException } from "../schema/required-evidence-exception.schema.js";
import { getEvidenceRecords } from "../services/evidence-service.js";
import { buildEvidenceSnapshotEntries } from "./evidence-gate-snapshot.js";
import { simulate } from "./evidence-gate-simulation-engine.js";
import { isProviderAccepted, meetsBindingRequirements, type BindingContext } from "./required-evidence-binding.js";
import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";

/**
 * M30 §6: evaluateRequiredEvidenceGate is the sole M30 owner for
 * enforcement classification. It calls the M28 snapshot builder and
 * simulator directly (getEvidenceRecords/buildEvidenceSnapshotEntries/
 * simulate) and copies none of trust ordering, artifact-kind selection,
 * scope matching, freshness, rule aggregation, snapshot canonicalization,
 * or simulation digests -- those stay exactly where M28 owns them. It adds
 * only the M30-specific provider/binding eligibility re-check on top of
 * an already-computed M28 rule result (see required-evidence-binding.ts),
 * and the deficiency/outcome classification new to M30.
 */

function classifyFailedRule(rule: EvidenceGateRuleResult): RequiredDeficiency {
  const rc = rule.rejectedCandidateCounts;
  if (rc.invalidReference > 0) return "invalid_reference";
  if (rc.insufficientTrust > 0) return "insufficient_trust";
  if (rc.stale > 0) return "stale";
  // No candidates were even rejected for a specific reason -- nothing exists at all.
  return "missing";
}

export interface RuleDecision {
  ruleId: string;
  deficiency: RequiredDeficiency;
  eligibleForException: boolean;
}

export interface TargetEvaluation {
  target: SimulationTarget;
  simulation: EvidenceGateSimulation;
  ruleDecisions: RuleDecision[];
}

function evaluateTarget(params: {
  policy: EvidenceGatePolicy;
  target: SimulationTarget;
  entries: ReturnType<typeof buildEvidenceSnapshotEntries>;
  evidenceById: Map<string, ReturnType<typeof getEvidenceRecords>[number]>;
  asOf: string;
  gateProfile: CheckpointGateProfile | ReviewGateProfile;
  bindingContext: BindingContext;
  exceptionEligibleRuleIds: ReadonlySet<string>;
}): TargetEvaluation {
  const simulation = simulate({ policy: params.policy, target: params.target, entries: params.entries, asOf: params.asOf, generatedAt: params.asOf });

  const ruleDecisions: RuleDecision[] = [];
  for (const rule of simulation.ruleResults) {
    if (rule.result === "not_applicable") continue;

    let deficiency: RequiredDeficiency = "none";
    if (rule.result === "fail") {
      deficiency = classifyFailedRule(rule);
    } else if (rule.result === "indeterminate") {
      deficiency = "indeterminate";
    } else if (rule.result === "pass") {
      const matchedEvidence = rule.matchedEvidenceRefs.map((id) => params.evidenceById.get(id)).filter((e): e is NonNullable<typeof e> => e !== undefined);
      const ineligible = matchedEvidence.find(
        (ev) => !isProviderAccepted(ev, params.gateProfile.acceptedProviders) || !meetsBindingRequirements(ev, params.gateProfile.bindingRequirements, params.bindingContext),
      );
      if (ineligible) {
        deficiency = !isProviderAccepted(ineligible, params.gateProfile.acceptedProviders) ? "provider_not_accepted" : "binding_mismatch";
      }
    }

    if (deficiency !== "none") {
      ruleDecisions.push({ ruleId: rule.ruleId, deficiency, eligibleForException: params.exceptionEligibleRuleIds.has(rule.ruleId) });
    }
  }

  return { target: params.target, simulation, ruleDecisions };
}

export interface EvaluateRequiredEvidenceGateParams {
  gate: RequiredGate;
  state: StateModel;
  project: ProjectModel;
  targets: SimulationTarget[];
  policy: EvidenceGatePolicy;
  gateProfile: CheckpointGateProfile | ReviewGateProfile;
  asOf: string;
  bindingContexts: ReadonlyMap<string, BindingContext>;
  /** Active, unexpired, unconsumed exceptions for this activation/gate/scope, pre-filtered by the caller. */
  activeExceptions: readonly RequiredEvidenceException[];
  onFailBehavior: "needs_review" | "block";
  onIndeterminateBehavior: "needs_review" | "block" | "fail_review" | "warn";
  onUnavailableBehavior: "needs_review" | "block" | "fail_review" | "warn";
}

export interface EvaluateRequiredEvidenceGateResult {
  outcome: RequiredDecisionOutcome;
  deficiency: RequiredDeficiency;
  targetEvaluations: TargetEvaluation[];
  simulationDigests: string[];
  consumedExceptionIds: string[];
  blockingRuleRefs: string[];
  summary: string;
}

/** Deterministic decision identity input -- caller mints the final decisionId/recordedAt. */
export interface RequiredEvidenceDecisionIdentityInput {
  gate: string;
  activationId: string;
  targetRefs: readonly string[];
  asOf: string;
  simulationDigests: readonly string[];
  outcome: string;
}

export function computeRequiredEvidenceDecisionId(input: RequiredEvidenceDecisionIdentityInput): string {
  return computeCanonicalPayloadDigest({ protocolVersion: "aiqt-required-evidence-decision-identity@1", ...input });
}

/**
 * M30 §6/§6.2: evaluates every target, aggregates deterministically (any
 * required target failure fails the gate, worst-outcome precedence
 * invalid > blocked > profile-fail > indeterminate > unavailable > allow),
 * resolves exact scoped exceptions, and returns one classified decision.
 * Pure -- performs no I/O and does not persist anything; callers own
 * persistence and exception-consumption bookkeeping.
 */
export function evaluateRequiredEvidenceGate(params: EvaluateRequiredEvidenceGateParams): EvaluateRequiredEvidenceGateResult {
  let targetEvaluations: TargetEvaluation[];
  try {
    const records = getEvidenceRecords(params.state);
    const evidenceById = new Map(records.map((r) => [r.evidenceId, r]));
    const entries = buildEvidenceSnapshotEntries(records, params.project.project.id);
    const exceptionEligibleRuleIds = new Set(params.gateProfile.exceptionEligibleRuleIds);

    targetEvaluations = params.targets.map((target) =>
      evaluateTarget({
        policy: params.policy,
        target,
        entries,
        evidenceById,
        asOf: params.asOf,
        gateProfile: params.gateProfile,
        bindingContext: params.bindingContexts.get(target.id) ?? { workUnitId: target.relatedWorkUnitId ?? target.id },
        exceptionEligibleRuleIds,
      }),
    );
  } catch {
    // M30 §6.2: the evaluation itself could not complete (e.g. corrupted
    // evidence data caught by buildEvidenceSnapshotEntries) -- a gate-level
    // "unavailable" deficiency, distinct from any per-rule M28 outcome.
    const behavior = params.onUnavailableBehavior;
    const outcome: RequiredDecisionOutcome = behavior === "block" || behavior === "fail_review" ? "blocked" : behavior === "warn" ? "allow" : "needs_review";
    return {
      outcome,
      deficiency: outcome === "allow" ? "none" : "unavailable",
      targetEvaluations: [],
      simulationDigests: [],
      consumedExceptionIds: [],
      blockingRuleRefs: [],
      summary: "Required evidence evaluation could not complete.",
    };
  }

  const simulationDigests = [...new Set(targetEvaluations.map((t) => t.simulation.simulationDigest))].sort();

  let worst: RequiredDecisionOutcome = "allow";
  let worstDeficiency: RequiredDeficiency = "none";
  const blockingRuleRefs: string[] = [];
  const consumedExceptionIds: string[] = [];
  let usedException = false;

  const rank: Record<RequiredDecisionOutcome, number> = { allow: 0, needs_review: 1, blocked: 2, invalid: 3 };

  for (const evaluation of targetEvaluations) {
    for (const rd of evaluation.ruleDecisions) {
      let ruleOutcome: RequiredDecisionOutcome;

      if (rd.deficiency === "invalid_reference" || rd.deficiency === "binding_mismatch") {
        ruleOutcome = "invalid";
      } else if (rd.deficiency === "missing") {
        const matchingException = rd.eligibleForException
          ? params.activeExceptions.find((e) => e.ruleIds.includes(rd.ruleId) && e.status === "active")
          : undefined;
        if (matchingException) {
          ruleOutcome = "allow";
          usedException = true;
          if (!consumedExceptionIds.includes(matchingException.exceptionId)) consumedExceptionIds.push(matchingException.exceptionId);
        } else {
          ruleOutcome = "blocked";
        }
      } else if (rd.deficiency === "provider_not_accepted" || rd.deficiency === "insufficient_trust" || rd.deficiency === "stale" || rd.deficiency === "failed") {
        const matchingException = rd.eligibleForException
          ? params.activeExceptions.find((e) => e.ruleIds.includes(rd.ruleId) && e.status === "active")
          : undefined;
        if (matchingException) {
          ruleOutcome = "allow";
          usedException = true;
          if (!consumedExceptionIds.includes(matchingException.exceptionId)) consumedExceptionIds.push(matchingException.exceptionId);
        } else {
          ruleOutcome = params.onFailBehavior === "block" ? "blocked" : "needs_review";
        }
      } else if (rd.deficiency === "indeterminate") {
        const behavior = params.onIndeterminateBehavior;
        ruleOutcome = behavior === "block" ? "blocked" : behavior === "fail_review" ? "blocked" : behavior === "warn" ? "allow" : "needs_review";
      } else {
        ruleOutcome = "allow";
      }

      if (rank[ruleOutcome] > rank[worst]) {
        worst = ruleOutcome;
        worstDeficiency = rd.deficiency;
      }
      if (ruleOutcome !== "allow") {
        blockingRuleRefs.push(`${evaluation.target.type}:${evaluation.target.id}:${rd.ruleId}`);
      }
    }
  }

  const summary =
    worst === "allow"
      ? usedException
        ? "Required evidence satisfied via a valid scoped exception."
        : "Required evidence satisfied."
      : worst === "needs_review"
        ? "Required evidence deficiency detected; retained as needs_review."
        : worst === "blocked"
          ? "Required evidence is missing or blocked with no eligible exception."
          : "Required evidence reference or binding is invalid.";

  return {
    outcome: worst,
    deficiency: worst === "allow" ? "none" : worstDeficiency,
    targetEvaluations,
    simulationDigests,
    consumedExceptionIds,
    blockingRuleRefs,
    summary,
  };
}
