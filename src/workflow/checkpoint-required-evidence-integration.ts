import type { StateModel } from "../schema/state.schema.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { Checkpoint } from "../schema/checkpoint.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import { resolveEffectiveEvidenceMode, getActiveActivation, getEnforcementProfiles, findEnforcementProfile, getRequiredEvidenceExceptions } from "../services/evidence-enforcement-service.js";
import { getEvidenceGatePolicies, findPolicy } from "../services/evidence-gate-policy-service.js";
import { evaluateRequiredEvidenceGate, computeRequiredEvidenceDecisionId } from "./required-evidence-gate.js";
import type { RequiredDecisionOutcome, RequiredDeficiency } from "../schema/required-evidence-decision.schema.js";

export interface CheckpointRequiredGateDecision {
  activationId: string;
  profileId: string;
  profileVersion: number;
  outcome: RequiredDecisionOutcome;
  deficiency: RequiredDeficiency;
  simulationDigests: string[];
  consumedExceptionIds: string[];
  blockingRuleRefs: string[];
  summary: string;
  decisionId: string;
}

export interface CheckpointRequiredGateOutcome {
  effectiveMode: "off" | "advisory" | "required";
  /** True only when a required checkpoint gate was actually configured and evaluated. */
  evaluated: boolean;
  decision?: CheckpointRequiredGateDecision;
  /** Present only for "needs_review" outcomes: the caller must re-derive the checkpoint with a forced needs_review target status. */
  downgradeToNeedsReview: boolean;
  /** Present only for "blocked"/"invalid" outcomes: the caller must reject with zero mutation. */
  rejection?: { exitCode: 2 | 3; summary: string; issueId: string };
}

const RECOVERY_COMMANDS_BY_DEFICIENCY: Partial<Record<RequiredDeficiency, string[]>> = {
  missing: ["aiqt evidence import --from-file <path>", "aiqt evidence gate simulate --checkpoint <checkpoint-id>"],
  insufficient_trust: ["aiqt evidence import --from-file <path>", "aiqt evidence gate simulate --checkpoint <checkpoint-id>"],
  stale: ["aiqt evidence import --from-file <path>"],
  provider_not_accepted: ["aiqt evidence import --from-file <path>"],
  failed: ["aiqt checkpoint amend --checkpoint <checkpoint-id> --acceptance passed --validation passed --reason <text>"],
  indeterminate: ["aiqt evidence gate simulate --checkpoint <checkpoint-id>"],
  unavailable: ["aiqt evidence gate advisory refresh --checkpoint <checkpoint-id>"],
  binding_mismatch: ["aiqt evidence import --from-file <path>"],
  invalid_reference: ["aiqt evidence import --from-file <path>"],
};

export function recoveryCommandsFor(deficiency: RequiredDeficiency): string[] {
  return RECOVERY_COMMANDS_BY_DEFICIENCY[deficiency] ?? [];
}

/**
 * M30 §6/§7.2: evaluates the shared required-evidence gate against a
 * candidate checkpoint that would otherwise become "done", BEFORE any
 * persistence. Returns pure data; the caller (checkpoint.command.ts) owns
 * all state/runlog mutation and never calls this after a write. When
 * effective mode is not "required", or the profile configures no
 * checkpoint gate, this is a complete no-op (off/advisory parity).
 */
export function evaluateCheckpointRequiredGate(params: {
  state: StateModel;
  project: ProjectModel;
  candidateCheckpoint: Checkpoint;
  candidateWorkUnits: WorkUnit[];
  workUnit: WorkUnit;
  timestamp: string;
}): CheckpointRequiredGateOutcome {
  const effectiveMode = resolveEffectiveEvidenceMode(params.state);
  if (effectiveMode !== "required") {
    return { effectiveMode, evaluated: false, downgradeToNeedsReview: false };
  }

  const activation = getActiveActivation(params.state);
  if (!activation) {
    // Derivation contract guarantees this cannot happen, but never assume.
    return { effectiveMode, evaluated: false, downgradeToNeedsReview: false };
  }

  const profile = findEnforcementProfile(activation.profileRef.profileId, activation.profileRef.version, getEnforcementProfiles(params.state));
  if (!profile || !profile.gates.checkpoint) {
    return { effectiveMode, evaluated: false, downgradeToNeedsReview: false };
  }
  const checkpointGate = profile.gates.checkpoint;

  const policy = findPolicy(checkpointGate.policyRef.policyId, checkpointGate.policyRef.version, getEvidenceGatePolicies(params.state));
  if (!policy || policy.policyDigest !== checkpointGate.policyRef.digest) {
    return {
      effectiveMode,
      evaluated: true,
      downgradeToNeedsReview: false,
      rejection: { exitCode: 3, summary: "The active enforcement profile's referenced policy could not be found or its digest does not match.", issueId: "CHECKPOINT-REQUIRED-GATE-POLICY-MISMATCH" },
    };
  }

  const candidateState: StateModel = {
    ...params.state,
    checkpoints: [...params.state.checkpoints, params.candidateCheckpoint],
    workGraph: { ...params.state.workGraph, workUnits: params.candidateWorkUnits },
  };

  const activeExceptions = getRequiredEvidenceExceptions(params.state).filter(
    (e) =>
      e.activationId === activation.activationId &&
      e.gate === "checkpoint" &&
      e.status === "active" &&
      new Date(e.expiresAt).getTime() > new Date(params.timestamp).getTime() &&
      e.scope.projectId === params.project.project.id &&
      (e.scope.workUnitId === undefined || e.scope.workUnitId === params.workUnit.id),
  );

  const result = evaluateRequiredEvidenceGate({
    gate: "checkpoint",
    state: candidateState,
    project: params.project,
    targets: [{ type: "checkpoint", id: params.candidateCheckpoint.id, relatedProjectId: params.project.project.id, relatedWorkUnitId: params.workUnit.id }],
    policy,
    gateProfile: checkpointGate,
    asOf: params.timestamp,
    bindingContexts: new Map([[params.candidateCheckpoint.id, { workUnitId: params.workUnit.id, packetId: params.candidateCheckpoint.packetId ?? undefined }]]),
    activeExceptions,
    onFailBehavior: checkpointGate.onFail,
    onIndeterminateBehavior: checkpointGate.onIndeterminate,
    onUnavailableBehavior: checkpointGate.onUnavailable,
  });

  const targetRefs = [`checkpoint:${params.candidateCheckpoint.id}`];
  const decisionId = computeRequiredEvidenceDecisionId({
    gate: "checkpoint",
    activationId: activation.activationId,
    targetRefs,
    asOf: params.timestamp,
    simulationDigests: result.simulationDigests,
    outcome: result.outcome,
  });

  const decision: CheckpointRequiredGateDecision = {
    activationId: activation.activationId,
    profileId: profile.profileId,
    profileVersion: profile.version,
    outcome: result.outcome,
    deficiency: result.deficiency,
    simulationDigests: result.simulationDigests,
    consumedExceptionIds: result.consumedExceptionIds,
    blockingRuleRefs: result.blockingRuleRefs,
    summary: result.summary,
    decisionId,
  };

  if (result.outcome === "blocked") {
    return {
      effectiveMode,
      evaluated: true,
      decision,
      downgradeToNeedsReview: false,
      rejection: { exitCode: 2, summary: `Required evidence gate blocked this checkpoint: ${result.summary}`, issueId: "CHECKPOINT-REQUIRED-EVIDENCE-BLOCKED" },
    };
  }
  if (result.outcome === "invalid") {
    return {
      effectiveMode,
      evaluated: true,
      decision,
      downgradeToNeedsReview: false,
      rejection: { exitCode: 3, summary: `Required evidence reference or binding is invalid: ${result.summary}`, issueId: "CHECKPOINT-REQUIRED-EVIDENCE-INVALID" },
    };
  }

  return {
    effectiveMode,
    evaluated: true,
    decision,
    downgradeToNeedsReview: result.outcome === "needs_review",
  };
}
