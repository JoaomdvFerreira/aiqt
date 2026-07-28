import type { StateModel } from "../schema/state.schema.js";
import type { EvidenceEnforcementProfile } from "../schema/evidence-enforcement-profile.schema.js";
import type { EvidenceGatePolicy } from "../schema/evidence-gate-policy.schema.js";
import type { ActivationMetrics } from "../schema/required-mode-activation-plan.schema.js";
import { GATE_K_CONDITION_WEIGHTS, type GateKConditionKey } from "../schema/required-mode-activation-plan.schema.js";
import { computeEvidenceAdvisoryTelemetry } from "./evidence-advisory-telemetry.js";
import { getRecoveryProofs } from "../services/evidence-enforcement-service.js";
import { readRunlogEvents } from "../state/runlog-store.js";
import { slugify } from "../services/issue-service.js";

/**
 * M30 Gate J architecture decision: M29's CheckpointAdvisoryObservation is
 * aggregate-only (one overallResult per checkpoint, not per-rule), so
 * "every required rule observed" is derived from the deterministic advisory
 * issueKey convention (mintAdvisoryIssueKey: `checkpoint:<id>:advisory:
 * <policyDigest12>:<slugifiedRuleId>`) recorded in every
 * evidence_gate.advisory_observation_recorded event's issueKeys -- a rule
 * that has ever failed/been indeterminate at least once for this policy has
 * necessarily been "observed" in that sense. A rule that has only ever
 * passed is also "observed" the moment ANY observation for its checkpoint
 * ran against a policy including it; since M29 does not persist per-rule
 * pass evidence, this function conservatively counts a rule as observed
 * only when direct evidence of it exists (an advisory issueKey referencing
 * it, or a recovery proof for it) -- documented explicitly as a Gate J
 * decision, not a silent approximation.
 */
export function extractObservedRuleIds(state: StateModel, runlogFile: string, policyDigest: string): Set<string> {
  const shortDigest = policyDigest.replace(/^sha256:/, "").slice(0, 12);
  const prefix = `:advisory:${shortDigest}:`;
  const observed = new Set<string>();

  for (const event of readRunlogEvents(runlogFile)) {
    if (event.type !== "evidence_gate.advisory_observation_recorded") continue;
    const issueKeys = (event.data as { issueKeys?: unknown } | undefined)?.issueKeys;
    if (!Array.isArray(issueKeys)) continue;
    for (const key of issueKeys) {
      if (typeof key !== "string") continue;
      const idx = key.indexOf(prefix);
      if (idx === -1) continue;
      observed.add(key.slice(idx + prefix.length));
    }
  }

  for (const proof of getRecoveryProofs(state)) {
    if (proof.policyDigest !== policyDigest) continue;
    observed.add(slugify(proof.ruleId));
  }

  return observed;
}

export interface GateKConditionInputs {
  state: StateModel;
  runlogFile: string;
  profile: EvidenceEnforcementProfile;
  policy: EvidenceGatePolicy;
  humanInputs: { activatedBy: string; reason: string; confirmProjectId: string; projectId: string } | null;
  /** Only present when re-verifying an existing plan (activate time); absent when computing a fresh plan (prepare time). */
  existingPlan?: { activationSnapshotDigest: string; expiresAt: string; generatedAtCheckDigest: string };
  now: string;
}

export interface GateKEvaluationResult {
  conditions: Record<GateKConditionKey, boolean>;
  blockers: string[];
  metrics: ActivationMetrics;
  projectActivationResidualRisk: number;
}

/**
 * M30 §4.6.1: evaluates every fixed Gate K condition against live
 * repository state and computes the deterministic maximum-of-open-
 * conditions residual risk. Reuses M28's policy owner, M29's telemetry
 * (including the just-corrected feedback.unclassified), and M22's
 * ProjectIssue/override lifecycle directly -- no second evaluator.
 */
export function evaluateGateKConditions(input: GateKConditionInputs): GateKEvaluationResult {
  const telemetry = computeEvidenceAdvisoryTelemetry(input.state, input.runlogFile);
  const requirements = input.profile.activationRequirements;
  const checkpointGate = input.profile.gates.checkpoint;

  const conditions: Record<GateKConditionKey, boolean> = {
    profileAndPolicyDigestsVerified: false,
    explicitHumanActivationInputsComplete: false,
    requiredAdvisoryPeriodComplete: false,
    acceptedFalsePositiveRateSatisfied: false,
    everyRequiredRuleObserved: false,
    everyRequiredRuleRecoveryProofValid: false,
    amendmentCompositionProven: false,
    readinessCompositionProven: false,
    advisoryRunlogHistoryComplete: false,
    unavailableObservationsZero: false,
    unresolvedDeadlockFindingsZero: false,
    activationSnapshotCurrentAndUnexpired: false,
  };
  const blockers: string[] = [];

  const policyDigestMatches = checkpointGate ? checkpointGate.policyRef.digest === input.policy.policyDigest : false;
  conditions.profileAndPolicyDigestsVerified = Boolean(checkpointGate) && policyDigestMatches;
  if (!conditions.profileAndPolicyDigestsVerified) blockers.push("Active profile and policy digests could not be verified.");

  conditions.explicitHumanActivationInputsComplete =
    input.humanInputs !== null &&
    input.humanInputs.activatedBy.trim() !== "" &&
    input.humanInputs.reason.trim() !== "" &&
    input.humanInputs.confirmProjectId === input.humanInputs.projectId;
  if (!conditions.explicitHumanActivationInputsComplete) blockers.push("Explicit human activation identity, reason, and project confirmation are required.");

  const observedCount = telemetry.pass + telemetry.fail + telemetry.indeterminate;
  conditions.requiredAdvisoryPeriodComplete = observedCount >= requirements.minimumAdvisoryObservations;
  if (!conditions.requiredAdvisoryPeriodComplete) blockers.push(`Advisory period incomplete: ${observedCount}/${requirements.minimumAdvisoryObservations} observations.`);

  const classifiedFindings = telemetry.feedback.confirmed + telemetry.feedback.falsePositive + telemetry.feedback.policyGap + telemetry.feedback.evidenceMissing;
  const falsePositiveRate = classifiedFindings > 0 ? telemetry.feedback.falsePositive / classifiedFindings : null;
  if (requirements.minimumClassifiedFindings > 0 && falsePositiveRate === null) {
    conditions.acceptedFalsePositiveRateSatisfied = false;
  } else if (classifiedFindings < requirements.minimumClassifiedFindings) {
    conditions.acceptedFalsePositiveRateSatisfied = false;
  } else {
    conditions.acceptedFalsePositiveRateSatisfied = falsePositiveRate === null || falsePositiveRate <= requirements.maximumAcceptedFalsePositiveRate;
  }
  if (!conditions.acceptedFalsePositiveRateSatisfied) blockers.push("Accepted false-positive-rate threshold not satisfied.");

  const requiredRuleIds = input.policy.rules.map((r) => slugify(r.ruleId));
  const observedRuleIds = extractObservedRuleIds(input.state, input.runlogFile, input.policy.policyDigest);
  conditions.everyRequiredRuleObserved = requiredRuleIds.every((id) => observedRuleIds.has(id));
  if (!conditions.everyRequiredRuleObserved) blockers.push("Not every policy rule has an observed advisory result or recovery proof.");

  const recoveryProofs = getRecoveryProofs(input.state).filter((p) => p.gate === "checkpoint" && p.policyDigest === input.policy.policyDigest);
  const provenRuleIds = new Set(recoveryProofs.map((p) => slugify(p.ruleId)));
  conditions.everyRequiredRuleRecoveryProofValid = requiredRuleIds.every((id) => provenRuleIds.has(id));
  if (!conditions.everyRequiredRuleRecoveryProofValid) blockers.push("Not every policy rule has a valid recovery proof.");

  conditions.amendmentCompositionProven = telemetry.refreshedAfterAmendment >= 1;
  if (!conditions.amendmentCompositionProven) blockers.push("Amendment-triggered advisory composition has not been demonstrated for this project.");

  conditions.readinessCompositionProven = telemetry.checkpointsCompletedDespiteFail >= 1 || telemetry.checkpointsCompletedDespiteIndeterminate >= 1;
  if (!conditions.readinessCompositionProven) blockers.push("Readiness-unaffected-by-advisory-outcome composition has not been demonstrated for this project.");

  conditions.advisoryRunlogHistoryComplete = telemetry.historyComplete;
  if (!conditions.advisoryRunlogHistoryComplete) blockers.push("Advisory runlog history is incomplete (a gap was detected).");

  conditions.unavailableObservationsZero = telemetry.unavailable === 0;
  if (!conditions.unavailableObservationsZero) blockers.push("One or more advisory observations are unavailable.");

  conditions.unresolvedDeadlockFindingsZero = telemetry.feedback.unclassified === 0;
  if (!conditions.unresolvedDeadlockFindingsZero) blockers.push("One or more advisory findings remain unclassified (treated as an open deadlock finding).");

  if (input.existingPlan) {
    conditions.activationSnapshotCurrentAndUnexpired =
      input.existingPlan.activationSnapshotDigest === input.existingPlan.generatedAtCheckDigest &&
      new Date(input.existingPlan.expiresAt).getTime() > new Date(input.now).getTime();
  } else {
    conditions.activationSnapshotCurrentAndUnexpired = true;
  }
  if (!conditions.activationSnapshotCurrentAndUnexpired) blockers.push("Activation snapshot has changed or the plan has expired.");

  let projectActivationResidualRisk = 0;
  for (const key of Object.keys(GATE_K_CONDITION_WEIGHTS) as GateKConditionKey[]) {
    if (!conditions[key]) projectActivationResidualRisk = Math.max(projectActivationResidualRisk, GATE_K_CONDITION_WEIGHTS[key]);
  }

  const metrics: ActivationMetrics = {
    advisoryObservations: observedCount,
    classifiedFindings,
    falsePositiveRate,
    runlogHistoryComplete: telemetry.historyComplete,
    unavailableObservations: telemetry.unavailable,
    rulesObserved: requiredRuleIds.filter((id) => observedRuleIds.has(id)).length,
    rulesRequired: requiredRuleIds.length,
    recoveryProofsValid: requiredRuleIds.filter((id) => provenRuleIds.has(id)).length,
    recoveryProofsRequired: requiredRuleIds.length,
  };

  return { conditions, blockers, metrics, projectActivationResidualRisk };
}
