import type { StateModel, ProjectStatus } from "../schema/state.schema.js";
import type {
  Checkpoint,
  AcceptanceCriteriaResult,
  ValidationResult,
} from "../schema/checkpoint.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { CheckpointAmendment } from "../schema/checkpoint-amendment.schema.js";
import { recalculateDependencyReadiness } from "../workflow/dependency-readiness.js";
import {
  applyCheckpointWorkUnitTransition,
  recalculateMilestoneStatuses,
  computeProjectStatus,
} from "../workflow/checkpoint-status-transitions.js";

/** M12 §6.1: missing state.checkpointAmendments must be treated as an empty array. */
export function getCheckpointAmendments(state: StateModel): CheckpointAmendment[] {
  return state.checkpointAmendments ?? [];
}

export function amendmentsForCheckpoint(
  checkpointId: string,
  amendments: readonly CheckpointAmendment[],
): CheckpointAmendment[] {
  return amendments.filter((a) => a.checkpointId === checkpointId);
}

export interface EffectiveCheckpointResult {
  acceptanceCriteriaResult: AcceptanceCriteriaResult;
  validationResult: ValidationResult;
}

/**
 * §9: effective result = latest amendment (by stored order) for that field,
 * if present, otherwise the original checkpoint result. Never mutates or
 * rewrites the original checkpoint record.
 */
export function computeEffectiveCheckpointResult(
  checkpoint: Checkpoint,
  amendments: readonly CheckpointAmendment[],
): EffectiveCheckpointResult {
  let acceptanceCriteriaResult = checkpoint.acceptanceCriteriaResult;
  let validationResult = checkpoint.validationResult;
  for (const amendment of amendmentsForCheckpoint(checkpoint.id, amendments)) {
    if (amendment.acceptanceCriteriaResult !== undefined) {
      acceptanceCriteriaResult = amendment.acceptanceCriteriaResult;
    }
    if (amendment.validationResult !== undefined) {
      validationResult = amendment.validationResult;
    }
  }
  return { acceptanceCriteriaResult, validationResult };
}

/** The most recently stored checkpoint for a given work unit, or undefined if none exists. */
export function latestCheckpointForWorkUnit(
  state: StateModel,
  workUnitId: string,
): Checkpoint | undefined {
  const list = state.checkpoints.filter((cp) => cp.workUnitId === workUnitId);
  return list[list.length - 1];
}

export interface ApplyCheckpointAmendmentParams {
  state: StateModel;
  checkpoint: Checkpoint;
  workUnit: WorkUnit;
  acceptanceCriteriaResult?: AcceptanceCriteriaResult;
  validationResult?: ValidationResult;
  amendmentId: string;
  reason: string;
  timestamp: string;
}

export interface ApplyCheckpointAmendmentResult {
  changed: boolean;
  amendment: CheckpointAmendment | null;
  effectiveAcceptanceCriteriaResult: AcceptanceCriteriaResult;
  effectiveValidationResult: ValidationResult;
  workUnitStatusBefore: WorkUnitStatus;
  workUnitStatusAfter: WorkUnitStatus;
  workUnits: WorkUnit[];
  milestones: Milestone[];
  projectStatus: ProjectStatus;
  newlyReadyWorkUnitIds: string[];
}

/**
 * §10/§10.1: apply a checkpoint amendment as an overlay. The only
 * amendment-triggered terminal transition is needs_review -> done, and only
 * when the completion gate passes: the amended checkpoint is the latest for
 * its work unit, effective validationResult and acceptanceCriteriaResult are
 * both "passed", and no active currentWorkUnitId points at this same work
 * unit. Done work units are never reopened or demoted. Pure and side-effect
 * free; callers persist the returned state and append the runlog event.
 */
export function applyCheckpointAmendment(
  params: ApplyCheckpointAmendmentParams,
): ApplyCheckpointAmendmentResult {
  const {
    state,
    checkpoint,
    workUnit,
    acceptanceCriteriaResult,
    validationResult,
    amendmentId,
    reason,
    timestamp,
  } = params;

  const existingAmendments = getCheckpointAmendments(state);
  const currentEffective = computeEffectiveCheckpointResult(checkpoint, existingAmendments);

  const changed =
    (acceptanceCriteriaResult !== undefined &&
      acceptanceCriteriaResult !== currentEffective.acceptanceCriteriaResult) ||
    (validationResult !== undefined && validationResult !== currentEffective.validationResult);

  if (!changed) {
    return {
      changed: false,
      amendment: null,
      effectiveAcceptanceCriteriaResult: currentEffective.acceptanceCriteriaResult,
      effectiveValidationResult: currentEffective.validationResult,
      workUnitStatusBefore: workUnit.status,
      workUnitStatusAfter: workUnit.status,
      workUnits: state.workGraph.workUnits,
      milestones: state.workGraph.milestones,
      projectStatus: state.projectStatus,
      newlyReadyWorkUnitIds: [],
    };
  }

  const newEffectiveAcceptance = acceptanceCriteriaResult ?? currentEffective.acceptanceCriteriaResult;
  const newEffectiveValidation = validationResult ?? currentEffective.validationResult;

  const amendment: CheckpointAmendment = {
    amendmentId,
    checkpointId: checkpoint.id,
    workUnitId: workUnit.id,
    ...(acceptanceCriteriaResult !== undefined ? { acceptanceCriteriaResult } : {}),
    ...(validationResult !== undefined ? { validationResult } : {}),
    reason,
    amendedAt: timestamp,
    sourceCommand: "aiqt checkpoint amend",
  };

  const latest = latestCheckpointForWorkUnit(state, workUnit.id);
  const isLatestCheckpoint = latest?.id === checkpoint.id;

  const completionGatePasses =
    workUnit.status === "needs_review" &&
    isLatestCheckpoint &&
    newEffectiveValidation === "passed" &&
    newEffectiveAcceptance === "passed" &&
    state.currentWorkUnitId !== workUnit.id;

  let workUnitStatusAfter: WorkUnitStatus = workUnit.status;
  let workUnits = state.workGraph.workUnits;
  let milestones = state.workGraph.milestones;
  let projectStatus = state.projectStatus;
  let newlyReadyWorkUnitIds: string[] = [];

  if (completionGatePasses) {
    workUnitStatusAfter = "done";
    workUnits = applyCheckpointWorkUnitTransition(
      state.workGraph.workUnits,
      workUnit.id,
      "done",
      timestamp,
    );
    const recalculated = recalculateDependencyReadiness(
      workUnits,
      state.workGraph.dependencies,
      timestamp,
    );
    workUnits = recalculated.workUnits;
    newlyReadyWorkUnitIds = recalculated.newlyReadyWorkUnitIds;
    milestones = recalculateMilestoneStatuses(workUnits, state.workGraph.milestones);
    projectStatus = computeProjectStatus(workUnits, "done");
  }

  return {
    changed: true,
    amendment,
    effectiveAcceptanceCriteriaResult: newEffectiveAcceptance,
    effectiveValidationResult: newEffectiveValidation,
    workUnitStatusBefore: workUnit.status,
    workUnitStatusAfter,
    workUnits,
    milestones,
    projectStatus,
    newlyReadyWorkUnitIds,
  };
}
