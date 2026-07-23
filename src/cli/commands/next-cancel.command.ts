import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildPacketCancelledEvent,
  findPreviousAgentPacketMetadata,
  readAgentPacketIds,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { runReview } from "../../services/review-service.js";
import { computeReviewNextCommand } from "../../workflow/review-next-command.js";
import { applyWorkUnitCancelTransition } from "../../workflow/work-unit-cancel-transition.js";
import { selectNextReadyWorkUnit } from "../../workflow/next-work-unit-selector.js";
import type { StateModel, ProjectStatus } from "../../schema/state.schema.js";
import type { WorkUnit } from "../../schema/work-unit.schema.js";
import { getExecutionSessions, findAnySessionForPacket } from "../../services/execution-session-service.js";

/**
 * Recompute projectStatus after cancelling the only in_progress work unit
 * (this engine never allows more than one in_progress unit at a time).
 * Mirrors computeProjectStatus's existing needs_review/all-done -> "review"
 * convention; otherwise the project reverts to "planned" (the same status
 * aiqt plan itself sets), since nothing remains actively in progress.
 */
function recomputeProjectStatusAfterCancel(workUnits: readonly WorkUnit[]): ProjectStatus {
  if (workUnits.some((wu) => wu.status === "needs_review")) return "review";
  if (workUnits.length > 0 && workUnits.every((wu) => wu.status === "done")) return "review";
  return "planned";
}

function blocked(
  state: StateModel,
  summary: string,
  nextRecommendedCommand: string,
  issueId: string,
): CommandResult {
  return makeResult({
    status: "blocked",
    action: "next",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary,
    nextRecommendedCommand,
    exitCode: ExitCode.WorkflowBlocked,
    blockingIssues: [
      {
        id: issueId,
        severity: "high",
        area: "workflow",
        message: summary,
        agentCanFix: false,
      },
    ],
  });
}

/**
 * aiqt next cancel (M9 §8.5): undo an accidental packet selection before any
 * checkpoint exists for that packet. Restores the work unit to
 * ready/planned, clears current pointers, restores lastAgentPacket to the
 * previous valid packet (or null), recomputes projectStatus (not stuck at
 * "in_progress" with nothing actually active -- beyond the spec's literal
 * mutation list, but required for state to stay internally consistent), and
 * appends a single packet.cancelled
 * runlog event. Never rewrites or deletes runlog history.
 */
export function runNextCancel(ctx: CommandContext): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "next",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "NEXT-CANCEL-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const { paths, project, state } = loadProject(ctx);

    if (state.currentWorkUnitId === null) {
      return blocked(
        state,
        "No work unit is currently in progress to cancel.",
        "aiqt next",
        "NEXT-CANCEL-NO-CURRENT-WORK-UNIT",
      );
    }

    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === state.currentWorkUnitId);
    if (!workUnit || workUnit.status !== "in_progress") {
      const message = `currentWorkUnitId "${state.currentWorkUnitId}" does not reference an in_progress work unit.`;
      return makeResult({
        status: "failed",
        action: "next",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt review",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "NEXT-CANCEL-INCONSISTENT-STATE",
            severity: "critical",
            area: "state",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (!state.lastAgentPacket || state.lastAgentPacket.workUnitId !== workUnit.id) {
      return blocked(
        state,
        "The current work unit has no matching last agent packet to cancel.",
        "aiqt review",
        "NEXT-CANCEL-NO-MATCHING-PACKET",
      );
    }
    const currentPacket = state.lastAgentPacket;

    const hasCheckpointForPacket = state.checkpoints.some((cp) => cp.packetId === currentPacket.id);
    if (hasCheckpointForPacket) {
      return blocked(
        state,
        "A checkpoint already exists for the current packet. Cancellation is no longer safe.",
        "aiqt review",
        "NEXT-CANCEL-CHECKPOINT-EXISTS",
      );
    }

    // M26 §5.3: any execution session for the current packet -- including
    // fully terminal history -- blocks packet cancellation. Durable
    // execution history must not be invalidated by cancelling the packet.
    const packetSessions = findAnySessionForPacket(currentPacket.id, getExecutionSessions(state));
    if (packetSessions.length > 0) {
      return blocked(
        state,
        `${packetSessions.length} execution session(s) exist for the current packet. Cancellation would invalidate durable execution history.`,
        "aiqt execution status",
        "NEXT-CANCEL-EXECUTION-SESSION-EXISTS",
      );
    }

    const timestamp = new Date().toISOString();
    const transition = applyWorkUnitCancelTransition(state, workUnit.id, timestamp);
    const previousPacket = findPreviousAgentPacketMetadata(paths.runlogFile, currentPacket.id);

    const updatedState: StateModel = {
      ...state,
      projectStatus: recomputeProjectStatusAfterCancel(transition.workUnits),
      workGraph: {
        ...state.workGraph,
        workUnits: transition.workUnits,
        milestones: transition.milestones,
      },
      currentWorkUnitId: null,
      lastAgentPacket: previousPacket,
    };
    const nextReady = selectNextReadyWorkUnit(updatedState);
    const currentMilestoneId = nextReady.milestone?.id ?? null;

    const knownPacketIds = readAgentPacketIds(paths.runlogFile, previousPacket);
    const stateForNextCommand: StateModel = { ...updatedState, currentMilestoneId };
    const review = runReview(project, stateForNextCommand, knownPacketIds);
    const nextRecommendedCommand = computeReviewNextCommand(
      project,
      stateForNextCommand,
      review.findings,
    );

    const newState: StateModel = {
      ...stateForNextCommand,
      nextRecommendedCommand,
      lastUpdatedAt: timestamp,
    };
    writeStateModel(paths.stateFile, newState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    appendRunlogEvent(
      paths.runlogFile,
      buildPacketCancelledEvent({
        id: eventId,
        timestamp,
        relatedIds: [currentPacket.id, workUnit.id, workUnit.milestoneId],
        data: {
          packetId: currentPacket.id,
          workUnitId: workUnit.id,
          milestoneId: workUnit.milestoneId,
          restoredWorkUnitStatus: transition.restoredStatus,
          previousLastAgentPacketId: previousPacket?.id ?? null,
          sourceCommand: "aiqt next cancel",
        },
      }),
    );

    return makeResult({
      status: "passed",
      action: "next",
      projectStatus: newState.projectStatus,
      currentMilestoneId: newState.currentMilestoneId,
      currentWorkUnitId: newState.currentWorkUnitId,
      summary: `Cancelled agent packet ${currentPacket.id} for work unit ${workUnit.id}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Restored work unit status",
        "Updated workflow state",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [workUnit.id, workUnit.milestoneId],
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        packetId: currentPacket.id,
        workUnitId: workUnit.id,
        restoredWorkUnitStatus: transition.restoredStatus,
        previousLastAgentPacketId: previousPacket?.id ?? null,
      },
    });
  } catch (err) {
    return errorToResult("next", err);
  }
}
