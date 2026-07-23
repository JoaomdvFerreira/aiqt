import { deriveFinalWorkUnitStatus } from "../workflow/checkpoint-completion-gate.js";
import { recalculateDependencyReadiness } from "../workflow/dependency-readiness.js";
import {
  applyCheckpointWorkUnitTransition,
  recalculateMilestoneStatuses,
  computeProjectStatus,
} from "../workflow/checkpoint-status-transitions.js";
import { selectNextReadyWorkUnit } from "../workflow/next-work-unit-selector.js";
import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { ProjectStatus } from "../schema/state.schema.js";
import type { Checkpoint } from "../schema/checkpoint.schema.js";
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
}

/**
 * Apply a validated checkpoint input to the current state. Pure and
 * side-effect free: throws AiqtError (exit code 1) via the completion gate
 * when a targetStatus = "done" claim is not acceptable, with no partial
 * mutation performed by the caller in that case.
 */
export function applyCheckpoint(params: {
  state: StateModel;
  workUnit: WorkUnit;
  input: CheckpointInput;
  checkpointId: string;
  timestamp: string;
  /** M26 §5.1: advisory-only reference to this packet's (already-terminal, by precondition) execution sessions. Never rewrites session history. */
  executionSessionIds?: string[];
}): ApplyCheckpointResult {
  const { state, workUnit, input, checkpointId, timestamp, executionSessionIds } = params;

  const finalStatus = deriveFinalWorkUnitStatus(input);

  let workUnits = applyCheckpointWorkUnitTransition(
    state.workGraph.workUnits,
    workUnit.id,
    finalStatus,
    timestamp,
  );

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

  const milestones = recalculateMilestoneStatuses(workUnits, state.workGraph.milestones);
  const projectStatus = computeProjectStatus(workUnits, finalStatus);

  const nextReady = selectNextReadyWorkUnit({
    ...state,
    workGraph: { ...state.workGraph, workUnits },
  });
  const nextReadyWorkUnitId = nextReady.workUnit?.id ?? null;

  let currentMilestoneId: string | null;
  let nextRecommendedCommand: string;
  if (finalStatus === "needs_review") {
    currentMilestoneId = workUnit.milestoneId;
    nextRecommendedCommand = "aiqt review";
  } else if (nextReadyWorkUnitId !== null) {
    currentMilestoneId = nextReady.milestone?.id ?? null;
    nextRecommendedCommand = "aiqt next";
  } else {
    currentMilestoneId = null;
    nextRecommendedCommand = "aiqt review";
  }

  const checkpoint: Checkpoint = {
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
    nextRecommendation: nextRecommendedCommand,
    createdAt: timestamp,
    ...(executionSessionIds && executionSessionIds.length > 0 ? { executionSessionIds } : {}),
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
  };
}
