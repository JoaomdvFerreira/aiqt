import type { StateModel } from "../schema/state.schema.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { SimulationTarget } from "../schema/evidence-gate-simulation.schema.js";
import { resolveEffectiveEvidenceMode, getActiveActivation, getEnforcementProfiles, findEnforcementProfile, getRequiredEvidenceExceptions } from "../services/evidence-enforcement-service.js";
import { getEvidenceGatePolicies, findPolicy } from "../services/evidence-gate-policy-service.js";
import { evaluateRequiredEvidenceGate, computeRequiredEvidenceDecisionId } from "./required-evidence-gate.js";
import type { RequiredDecisionOutcome, RequiredDeficiency } from "../schema/required-evidence-decision.schema.js";
import type { BindingContext } from "./required-evidence-binding.js";

export type ReviewGateKind = "development_review" | "release_review";

export interface ReviewRequiredGateDecision {
  activationId: string;
  profileId: string;
  profileVersion: number;
  outcome: RequiredDecisionOutcome;
  deficiency: RequiredDeficiency;
  simulationDigests: string[];
  blockingRuleRefs: string[];
  summary: string;
  decisionId: string;
}

export interface ReviewRequiredGateOutcome {
  effectiveMode: "off" | "advisory" | "required";
  evaluated: boolean;
  decision?: ReviewRequiredGateDecision;
  /** true when the gate demands exit 1 (fail_review or a fail/needs_review-class deficiency) */
  failsReview: boolean;
  /** true when the gate demands exit 3 (invalid reference/binding) */
  invalid: boolean;
}

/**
 * M30 §8.1/§9.2: development/release review target sets are deterministic,
 * deduplicated, and sorted; grandfathered Work Units are excluded.
 */
export function buildReviewTargetSet(params: {
  state: StateModel;
  project: ProjectModel;
  targetSet: readonly ("project" | "effective_done_work_units" | "effective_checkpoints")[];
  grandfatheredWorkUnitIds: readonly string[];
}): { targets: SimulationTarget[]; bindingContexts: Map<string, BindingContext> } {
  const grandfathered = new Set(params.grandfatheredWorkUnitIds);
  const targets: SimulationTarget[] = [];
  const bindingContexts = new Map<string, BindingContext>();
  const seen = new Set<string>();

  const addTarget = (t: SimulationTarget, ctx: BindingContext) => {
    const key = `${t.type}:${t.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(t);
    bindingContexts.set(t.id, ctx);
  };

  for (const kind of params.targetSet) {
    if (kind === "project") {
      addTarget({ type: "project", id: params.project.project.id, relatedProjectId: params.project.project.id }, { workUnitId: params.project.project.id });
    } else if (kind === "effective_done_work_units") {
      for (const wu of params.state.workGraph.workUnits) {
        if (wu.status !== "done" || grandfathered.has(wu.id)) continue;
        addTarget({ type: "work_unit", id: wu.id, relatedProjectId: params.project.project.id }, { workUnitId: wu.id });
      }
    } else if (kind === "effective_checkpoints") {
      for (const cp of params.state.checkpoints) {
        if (grandfathered.has(cp.workUnitId)) continue;
        addTarget({ type: "checkpoint", id: cp.id, relatedProjectId: params.project.project.id, relatedWorkUnitId: cp.workUnitId }, { workUnitId: cp.workUnitId, packetId: cp.packetId ?? undefined });
      }
    }
  }

  targets.sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  return { targets, bindingContexts };
}

/**
 * M30 §6/§8.1: evaluates the shared required-evidence gate for one review
 * gate (development or release). Off/advisory modes, or a profile with no
 * matching review gate configured, are a complete no-op. Development
 * exceptions never satisfy release (enforced by filtering active
 * exceptions to `gate === reviewGateKind` exactly).
 */
export function evaluateReviewRequiredGate(params: {
  state: StateModel;
  project: ProjectModel;
  reviewGateKind: ReviewGateKind;
  asOf: string;
}): ReviewRequiredGateOutcome {
  const effectiveMode = resolveEffectiveEvidenceMode(params.state);
  if (effectiveMode !== "required") {
    return { effectiveMode, evaluated: false, failsReview: false, invalid: false };
  }

  const activation = getActiveActivation(params.state);
  if (!activation) return { effectiveMode, evaluated: false, failsReview: false, invalid: false };

  const profile = findEnforcementProfile(activation.profileRef.profileId, activation.profileRef.version, getEnforcementProfiles(params.state));
  const reviewGate = params.reviewGateKind === "development_review" ? profile?.gates.developmentReview : profile?.gates.releaseReview;
  if (!profile || !reviewGate) {
    return { effectiveMode, evaluated: false, failsReview: false, invalid: false };
  }

  const policy = findPolicy(reviewGate.policyRef.policyId, reviewGate.policyRef.version, getEvidenceGatePolicies(params.state));
  if (!policy || policy.policyDigest !== reviewGate.policyRef.digest) {
    return {
      effectiveMode,
      evaluated: true,
      failsReview: false,
      invalid: true,
      decision: {
        activationId: activation.activationId,
        profileId: profile.profileId,
        profileVersion: profile.version,
        outcome: "invalid",
        deficiency: "invalid_reference",
        simulationDigests: [],
        blockingRuleRefs: [],
        summary: "The review gate's referenced policy could not be found or its digest does not match.",
        decisionId: computeRequiredEvidenceDecisionId({ gate: params.reviewGateKind, activationId: activation.activationId, targetRefs: [], asOf: params.asOf, simulationDigests: [], outcome: "invalid" }),
      },
    };
  }

  const { targets, bindingContexts } = buildReviewTargetSet({
    state: params.state,
    project: params.project,
    targetSet: reviewGate.targetSet,
    grandfatheredWorkUnitIds: activation.grandfatheredWorkUnitIds,
  });

  if (targets.length === 0) {
    return { effectiveMode, evaluated: false, failsReview: false, invalid: false };
  }

  const activeExceptions = getRequiredEvidenceExceptions(params.state).filter(
    (e) => e.activationId === activation.activationId && e.gate === params.reviewGateKind && e.status === "active" && new Date(e.expiresAt).getTime() > new Date(params.asOf).getTime() && e.scope.projectId === params.project.project.id,
  );

  const result = evaluateRequiredEvidenceGate({
    gate: params.reviewGateKind,
    state: params.state,
    project: params.project,
    targets,
    policy,
    gateProfile: reviewGate,
    asOf: params.asOf,
    bindingContexts,
    activeExceptions,
    onFailBehavior: "block",
    onIndeterminateBehavior: reviewGate.onIndeterminate === "fail_review" ? "block" : "warn",
    onUnavailableBehavior: reviewGate.onUnavailable === "fail_review" ? "block" : "warn",
  });

  const decisionId = computeRequiredEvidenceDecisionId({
    gate: params.reviewGateKind,
    activationId: activation.activationId,
    targetRefs: targets.map((t) => `${t.type}:${t.id}`),
    asOf: params.asOf,
    simulationDigests: result.simulationDigests,
    outcome: result.outcome,
  });

  return {
    effectiveMode,
    evaluated: true,
    failsReview: result.outcome === "blocked" || result.outcome === "needs_review",
    invalid: result.outcome === "invalid",
    decision: {
      activationId: activation.activationId,
      profileId: profile.profileId,
      profileVersion: profile.version,
      outcome: result.outcome,
      deficiency: result.deficiency,
      simulationDigests: result.simulationDigests,
      blockingRuleRefs: result.blockingRuleRefs,
      summary: result.summary,
      decisionId,
    },
  };
}
