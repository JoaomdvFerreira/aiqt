import type { StateModel } from "../schema/state.schema.js";
import type { ProjectModel } from "../schema/project.schema.js";
import { resolveActivePolicy } from "../services/evidence-gate-policy-service.js";
import { getEvidenceRecords } from "../services/evidence-service.js";
import { buildEvidenceSnapshotEntries } from "./evidence-gate-snapshot.js";
import { simulate } from "./evidence-gate-simulation-engine.js";
import type { SimulationTarget } from "../schema/evidence-gate-simulation.schema.js";
import type { EvidenceGateSimulation } from "../schema/evidence-gate-simulation.schema.js";
import type { AdvisoryEvaluationStatus, AdvisoryTrigger } from "../schema/checkpoint-evidence-advisory.schema.js";

export interface CheckpointAdvisoryEvaluationResult {
  evaluationStatus: AdvisoryEvaluationStatus;
  simulation: EvidenceGateSimulation | null;
  unavailableReason: string | null;
}

/**
 * M29 §3.2: "M29 must call the M28 policy-selection and simulation
 * services. It must not copy trust comparison, artifact-kind matching,
 * scope matching, freshness, rule aggregation, snapshot canonicalization,
 * or simulation digest logic." This is a thin orchestration wrapper around
 * resolveActivePolicy/getEvidenceRecords/buildEvidenceSnapshotEntries/
 * simulate (all M28-owned) -- it contains no evaluation logic of its own.
 * `unavailable` is reserved for genuine evaluation failures (e.g. corrupted
 * evidence data caught by buildEvidenceSnapshotEntries); "no active policy"
 * is its own non-error status, `not_configured`.
 */
export function evaluateCheckpointAdvisory(params: {
  state: StateModel;
  project: ProjectModel;
  checkpointId: string;
  workUnitId: string;
  trigger: AdvisoryTrigger;
  asOf: string;
  generatedAt: string;
}): CheckpointAdvisoryEvaluationResult {
  const policy = resolveActivePolicy(params.state);
  if (!policy) {
    return { evaluationStatus: "not_configured", simulation: null, unavailableReason: null };
  }

  try {
    const records = getEvidenceRecords(params.state);
    const entries = buildEvidenceSnapshotEntries(records, params.project.project.id);
    const target: SimulationTarget = {
      type: "checkpoint",
      id: params.checkpointId,
      relatedProjectId: params.project.project.id,
      relatedWorkUnitId: params.workUnitId,
    };
    const simulation = simulate({
      policy,
      target,
      entries,
      asOf: params.asOf,
      generatedAt: params.generatedAt,
    });
    return { evaluationStatus: "evaluated", simulation, unavailableReason: null };
  } catch (err) {
    return {
      evaluationStatus: "unavailable",
      simulation: null,
      unavailableReason: err instanceof Error ? err.message : String(err),
    };
  }
}
