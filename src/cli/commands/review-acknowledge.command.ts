import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildReviewFindingAcknowledgedEvent,
  readAgentPacketIds,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { runReview } from "../../services/review-service.js";
import { getAcknowledgedFindings, findingsForMode } from "../../services/manage-service.js";
import { computeReviewNextCommand } from "../../workflow/review-next-command.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { AcknowledgedFinding } from "../../schema/review-acknowledgment.schema.js";

export interface RunReviewAcknowledgeOptions {
  findingKey?: string;
  reason?: string;
}

const SOURCE_COMMAND = "aiqt review acknowledge";

/** relatedIds for the runlog event: the entity id embedded in the finding key, if any. */
function relatedIdsForFindingKey(findingKey: string): string[] {
  const parts = findingKey.split(":");
  if (parts.length >= 2 && (parts[0] === "checkpoint" || parts[0] === "workunit")) {
    return [parts[1]];
  }
  return [];
}

/**
 * aiqt review acknowledge <finding-key> --reason "..." (M9 §8.3). Stores an
 * auditable acknowledgment in state.review.acknowledgedFindings; never
 * rewrites the original checkpoint or deletes the finding from history.
 */
export function runReviewAcknowledge(
  ctx: CommandContext,
  options: RunReviewAcknowledgeOptions,
): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "review",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "REVIEW-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const findingKey = (options.findingKey ?? "").trim();
    if (findingKey === "") {
      const message = "A finding-key is required: aiqt review acknowledge <finding-key> --reason \"...\"";
      return makeResult({
        status: "failed",
        action: "review",
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "REVIEW-ACKNOWLEDGE-MISSING-KEY",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const reason = (options.reason ?? "").trim();
    if (reason === "") {
      const message = "--reason is required and must be non-empty.";
      return makeResult({
        status: "failed",
        action: "review",
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "REVIEW-ACKNOWLEDGE-MISSING-REASON",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const { paths, project, state } = loadProject(ctx);

    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const review = runReview(project, state, knownPacketIds);
    const activeKeys = new Set(review.findings.map((f) => f.findingKey));
    const existingAcknowledged = getAcknowledgedFindings(state);
    const alreadyAcknowledged = existingAcknowledged.find((a) => a.findingKey === findingKey);

    if (!activeKeys.has(findingKey) && !alreadyAcknowledged) {
      const message = `Finding key "${findingKey}" does not match any active review finding.`;
      return makeResult({
        status: "failed",
        action: "review",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt review",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "REVIEW-ACKNOWLEDGE-UNKNOWN-KEY",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    // Idempotent success: re-acknowledging the same finding key stores no
    // second record and appends no second runlog event (§8.3).
    if (alreadyAcknowledged) {
      return makeResult({
        status: "passed",
        action: "review",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Finding "${findingKey}" was already acknowledged.`,
        nextRecommendedCommand: "aiqt review",
        exitCode: ExitCode.Success,
        data: {
          findingKey,
          alreadyAcknowledged: true,
          acknowledgment: alreadyAcknowledged,
        },
      });
    }

    const timestamp = new Date().toISOString();
    const newAcknowledgment: AcknowledgedFinding = {
      findingKey,
      reason,
      acknowledgedAt: timestamp,
      sourceCommand: SOURCE_COMMAND,
    };
    const updatedAcknowledged = [...existingAcknowledged, newAcknowledgment];

    const newState: StateModel = {
      ...state,
      review: { acknowledgedFindings: updatedAcknowledged },
      lastUpdatedAt: timestamp,
    };
    writeStateModel(paths.stateFile, newState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    const relatedIds = relatedIdsForFindingKey(findingKey);
    appendRunlogEvent(
      paths.runlogFile,
      buildReviewFindingAcknowledgedEvent({
        id: eventId,
        timestamp,
        relatedIds,
        data: { findingKey, reason, sourceCommand: SOURCE_COMMAND },
      }),
    );

    const findingsForNextCommand = findingsForMode(review, updatedAcknowledged, "development");
    const nextRecommendedCommand = computeReviewNextCommand(
      project,
      newState,
      findingsForNextCommand,
    );

    return makeResult({
      status: "passed",
      action: "review",
      projectStatus: newState.projectStatus,
      currentMilestoneId: newState.currentMilestoneId,
      currentWorkUnitId: newState.currentWorkUnitId,
      summary: `Acknowledged review finding ${findingKey}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Stored acknowledgment",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: relatedIds,
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        findingKey,
        reason,
        acknowledgedAt: timestamp,
        sourceCommand: SOURCE_COMMAND,
      },
    });
  } catch (err) {
    return errorToResult("review", err);
  }
}
