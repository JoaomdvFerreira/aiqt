import type { StateModel } from "../schema/state.schema.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { AdvisoryTrigger, CheckpointAdvisoryObservation } from "../schema/checkpoint-evidence-advisory.schema.js";
import { evaluateCheckpointAdvisory, type CheckpointAdvisoryEvaluationResult } from "./checkpoint-advisory-evaluation.js";
import { computeAdvisoryObservationId } from "./checkpoint-advisory-identity.js";
import { applyAdvisoryObservation, findCheckpointAdvisory, type ApplyAdvisoryObservationOutcome } from "./checkpoint-advisory-state.js";

const UNAVAILABLE_SUMMARY = "Evidence-gate advisory evaluation could not complete. Retry with an explicit refresh.";
const NOT_CONFIGURED_SUMMARY = "No active evidence gate policy is configured.";

function boundedSummary(evaluationStatus: string, overallResult: string | null): string {
  if (evaluationStatus === "not_configured") return NOT_CONFIGURED_SUMMARY;
  if (evaluationStatus === "unavailable") return UNAVAILABLE_SUMMARY;
  return `Evidence gate advisory result: ${overallResult ?? "unknown"}.`;
}

export interface RunCheckpointAdvisoryParams {
  state: StateModel;
  project: ProjectModel;
  checkpointId: string;
  workUnitId: string;
  trigger: AdvisoryTrigger;
  asOf: string;
  recordedAt: string;
  /** Pre-computed by the M22 issue-routing step (WU29-02); empty for pass/not_configured/unavailable. */
  issueKeys: string[];
}

export interface RunCheckpointAdvisoryResult {
  evaluation: CheckpointAdvisoryEvaluationResult;
  observation: CheckpointAdvisoryObservation;
  applyOutcome: ApplyAdvisoryObservationOutcome;
}

/**
 * M29 §3.1/§3.2: the single non-blocking advisory pipeline shared by
 * automatic checkpoint evaluation, amendment-triggered refresh, and
 * explicit refresh. Pure -- callers are responsible for persisting the
 * returned advisory and appending the runlog event; this function performs
 * no I/O itself.
 */
export function runCheckpointAdvisory(params: RunCheckpointAdvisoryParams): RunCheckpointAdvisoryResult {
  const evaluation = evaluateCheckpointAdvisory({
    state: params.state,
    project: params.project,
    checkpointId: params.checkpointId,
    workUnitId: params.workUnitId,
    trigger: params.trigger,
    asOf: params.asOf,
    generatedAt: params.recordedAt,
  });

  const simulation = evaluation.simulation;
  const policyRef = simulation
    ? { policyId: simulation.policy.policyId, version: simulation.policy.version, digest: simulation.policy.digest }
    : undefined;

  const observationId = computeAdvisoryObservationId({
    checkpointId: params.checkpointId,
    trigger: params.trigger,
    evaluationStatus: evaluation.evaluationStatus,
    policyId: simulation?.policy.policyId ?? null,
    policyVersion: simulation?.policy.version ?? null,
    policyDigest: simulation?.policy.digest ?? null,
    asOf: params.asOf,
    overallResult: simulation?.overallResult ?? null,
    simulationDigest: simulation?.simulationDigest ?? null,
  });

  const observation: CheckpointAdvisoryObservation = {
    observationId,
    checkpointId: params.checkpointId,
    workUnitId: params.workUnitId,
    trigger: params.trigger,
    evaluationStatus: evaluation.evaluationStatus,
    overallResult: simulation?.overallResult ?? null,
    ...(policyRef ? { policyRef } : {}),
    asOf: params.asOf,
    ...(simulation ? { simulationDigest: simulation.simulationDigest } : {}),
    issueKeys: [...params.issueKeys].sort(),
    summary: boundedSummary(evaluation.evaluationStatus, simulation?.overallResult ?? null),
    recordedAt: params.recordedAt,
  };

  const existing = findCheckpointAdvisory(params.state.checkpointEvidenceAdvisories, params.checkpointId);
  const applyOutcome = applyAdvisoryObservation(existing, observation);

  return { evaluation, observation, applyOutcome };
}
