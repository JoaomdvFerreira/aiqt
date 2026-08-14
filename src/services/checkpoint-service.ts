import { deriveFinalWorkUnitStatus } from "../workflow/checkpoint-completion-gate.js";
import { recalculateDependencyReadiness } from "../workflow/dependency-readiness.js";
import {
  applyCheckpointWorkUnitTransition,
  recalculateMilestoneStatuses,
} from "../workflow/checkpoint-status-transitions.js";
import { selectNextReadyWorkUnit } from "../workflow/next-work-unit-selector.js";
import { assessWorkflow } from "../workflow/workflow-assessment.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { ProjectStatus } from "../schema/state.schema.js";
import type { Checkpoint, CheckpointDisposition } from "../schema/checkpoint.schema.js";
import type { CheckpointInput } from "../schema/checkpoint-input.schema.js";

export interface ApplyCheckpointResult {
  checkpoint: Checkpoint;
  workUnits: WorkUnit[];
  milestones: Milestone[];
  projectStatus: ProjectStatus;
  currentMilestoneId: string | null;
  newlyReadyWorkUnitIds: string[];
  nextReadyWorkUnitId: string | null;
  nextRecommendedCommand: string;
  disposition: CheckpointDisposition;
}

/**
 * Apply a validated checkpoint input to the current state. Pure and
 * side-effect free: throws AiqtError (exit code 1) via the completion gate
 * when a targetStatus = "done" claim is not acceptable, with no partial
 * mutation performed by the caller in that case.
 */
export function applyCheckpoint(params: {
  project: ProjectModel;
  state: StateModel;
  workUnit: WorkUnit;
  input: CheckpointInput;
  checkpointId: string;
  timestamp: string;
  /** M26 §5.1: advisory-only reference to this packet's (already-terminal, by precondition) execution sessions. Never rewrites session history. */
  executionSessionIds?: string[];
}): ApplyCheckpointResult {
  const { project, state, workUnit, input, checkpointId, timestamp, executionSessionIds } = params;

  const disposition: CheckpointDisposition = input.disposition ?? "terminal";
  const finalStatus = disposition === "terminal" ? deriveFinalWorkUnitStatus(input) : null;

  let workUnits = disposition === "terminal"
    ? applyCheckpointWorkUnitTransition(state.workGraph.workUnits, workUnit.id, finalStatus!, timestamp)
    : state.workGraph.workUnits;

  let newlyReadyWorkUnitIds: string[] = [];
  if (finalStatus === "done") {
    const recalculated = recalculateDependencyReadiness(
      workUnits,
      state.workGraph.dependencies,
      timestamp,
    );
    workUnits = recalculated.workUnits;
    newlyReadyWorkUnitIds = recalculated.newlyReadyWorkUnitIds;
  }

  const milestones = disposition === "terminal"
    ? recalculateMilestoneStatuses(workUnits, state.workGraph.milestones)
    : state.workGraph.milestones;

  const nextReady = selectNextReadyWorkUnit({
    ...state,
    workGraph: { ...state.workGraph, workUnits },
  });
  const nextReadyWorkUnitId = nextReady.workUnit?.id ?? null;

  const checkpointBase: Omit<Checkpoint, "nextRecommendation"> = {
    id: checkpointId,
    workUnitId: workUnit.id,
    packetId: state.lastAgentPacket?.id ?? null,
    summary: input.summary,
    completed: input.completed,
    notCompleted: input.notCompleted,
    filesChanged: input.filesChanged,
    issues: input.issues.map((issue) => ({
      title: issue.title,
      description: issue.description ?? null,
      severity: issue.severity,
      status: issue.status ?? "open",
      agentCanFix: issue.agentCanFix ?? true,
    })),
    validationResult: input.validationResult,
    acceptanceCriteriaResult: input.acceptanceCriteriaResult,
    validationCommands: input.validationCommands.map((c) => ({
      command: c.command,
      result: c.result,
      summary: c.summary ?? null,
    })),
    acceptanceCriteria: input.acceptanceCriteria.map((c) => ({
      criterion: c.criterion,
      result: c.result,
      evidence: c.evidence ?? null,
    })),
    finalWorkUnitStatus: finalStatus,
    ...(disposition === "progress" ? { disposition } : {}),
    createdAt: timestamp,
    ...(executionSessionIds && executionSessionIds.length > 0 ? { executionSessionIds } : {}),
  };

  const candidateState: StateModel = {
    ...state,
    currentMilestoneId: disposition === "progress"
      ? state.currentMilestoneId
      : (finalStatus === "needs_review" ? workUnit.milestoneId : (nextReady.milestone?.id ?? null)),
    currentWorkUnitId: disposition === "progress" ? workUnit.id : null,
    workGraph: { ...state.workGraph, workUnits, milestones },
    checkpoints: [...state.checkpoints, { ...checkpointBase, nextRecommendation: disposition === "progress" ? "aiqt continue" : "aiqt checkpoint amend" }],
  };
  const assessment = assessWorkflow(project, candidateState);
  const projectStatus = assessment.projectStatus;
  const currentMilestoneId = candidateState.currentMilestoneId;
  const nextRecommendedCommand = disposition === "progress" ? "aiqt continue" : (assessment.recommendedCommand ?? "aiqt review");

  const checkpoint: Checkpoint = {
    ...checkpointBase,
    nextRecommendation: nextRecommendedCommand,
  };

  return {
    checkpoint,
    workUnits,
    milestones,
    projectStatus,
    currentMilestoneId,
    newlyReadyWorkUnitIds,
    nextReadyWorkUnitId,
    nextRecommendedCommand,
    disposition,
  };
}
