import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildCheckpointAmendedEvent,
  readAgentPacketIds,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { runReview } from "../../services/review-service.js";
import { computeReviewNextCommand } from "../../workflow/review-next-command.js";
import { selectNextReadyWorkUnit } from "../../workflow/next-work-unit-selector.js";
import { applyCheckpointAmendment } from "../../services/checkpoint-amendment-service.js";
import {
  AcceptanceCriteriaResultSchema,
  ValidationResultSchema,
  type AcceptanceCriteriaResult,
  type ValidationResult,
} from "../../schema/checkpoint.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunCheckpointAmendOptions {
  checkpointId?: string;
  acceptance?: string;
  validation?: string;
  reason?: string;
}

const SOURCE_COMMAND = "aiqt checkpoint amend";

/** Work unit statuses whose checkpoints may be amended at all (M12 §10). */
const AMENDABLE_STATUSES = new Set(["done", "needs_review"]);

function failInvalidInput(id: string, message: string): CommandResult {
  return makeResult({
    status: "failed",
    action: "checkpoint",
    summary: message,
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [
      {
        id,
        severity: "high",
        area: "input",
        message,
        agentCanFix: false,
      },
    ],
  });
}

/**
 * aiqt checkpoint amend --checkpoint <id> [--acceptance ...] [--validation ...]
 * --reason "..." (M12 §8.1). Stores an amendment overlay without rewriting
 * the original checkpoint. The only amendment-triggered status transition is
 * needs_review -> done, gated by applyCheckpointAmendment's completion gate;
 * done work units are never reopened or demoted.
 */
export function runCheckpointAmend(
  ctx: CommandContext,
  options: RunCheckpointAmendOptions,
): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "checkpoint",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const checkpointId = (options.checkpointId ?? "").trim();
    if (checkpointId === "") {
      return failInvalidInput(
        "CHECKPOINT-AMEND-MISSING-ID",
        'A checkpoint id is required: aiqt checkpoint amend --checkpoint <checkpoint-id> [--acceptance ...] [--validation ...] --reason "..."',
      );
    }

    if (options.acceptance === undefined && options.validation === undefined) {
      return failInvalidInput(
        "CHECKPOINT-AMEND-MISSING-FIELD",
        "At least one of --acceptance or --validation is required.",
      );
    }

    let acceptanceCriteriaResult: AcceptanceCriteriaResult | undefined;
    if (options.acceptance !== undefined) {
      const parsed = AcceptanceCriteriaResultSchema.safeParse(options.acceptance);
      if (!parsed.success) {
        return failInvalidInput(
          "CHECKPOINT-AMEND-INVALID-ACCEPTANCE",
          `--acceptance must be one of: ${AcceptanceCriteriaResultSchema.options.join(", ")}.`,
        );
      }
      acceptanceCriteriaResult = parsed.data;
    }

    let validationResult: ValidationResult | undefined;
    if (options.validation !== undefined) {
      const parsed = ValidationResultSchema.safeParse(options.validation);
      if (!parsed.success) {
        return failInvalidInput(
          "CHECKPOINT-AMEND-INVALID-VALIDATION",
          `--validation must be one of: ${ValidationResultSchema.options.join(", ")}.`,
        );
      }
      validationResult = parsed.data;
    }

    const reason = (options.reason ?? "").trim();
    if (reason === "") {
      return failInvalidInput(
        "CHECKPOINT-AMEND-MISSING-REASON",
        "--reason is required and must be non-empty.",
      );
    }

    const { paths, project, state } = loadProject(ctx);

    const checkpoint = state.checkpoints.find((cp) => cp.id === checkpointId);
    if (!checkpoint) {
      const message = `Checkpoint "${checkpointId}" does not exist.`;
      return makeResult({
        status: "failed",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-UNKNOWN-CHECKPOINT",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === checkpoint.workUnitId);
    if (!workUnit) {
      const message = `Checkpoint "${checkpointId}" references workUnitId "${checkpoint.workUnitId}", which does not exist.`;
      return makeResult({
        status: "failed",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-INVALID-STATE",
            severity: "critical",
            area: "state",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (!AMENDABLE_STATUSES.has(workUnit.status)) {
      const message = `Work unit "${workUnit.id}" has status "${workUnit.status}", which cannot be amended. Only done and needs_review work units may be amended.`;
      return makeResult({
        status: "blocked",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-STATUS-NOT-AMENDABLE",
            severity: "medium",
            area: "workflow",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const timestamp = new Date().toISOString();
    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);

    const amendmentIds = (state.checkpointAmendments ?? []).map((a) => a.amendmentId);
    const amendmentId = nextId("AMEND", amendmentIds, "-");

    const applied = applyCheckpointAmendment({
      state,
      checkpoint,
      workUnit,
      acceptanceCriteriaResult,
      validationResult,
      amendmentId,
      reason,
      timestamp,
    });

    if (!applied.changed) {
      const review = runReview(project, state, knownPacketIds);
      const nextRecommendedCommand = computeReviewNextCommand(project, state, review.findings);
      return makeResult({
        status: "passed",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Checkpoint "${checkpointId}" already has the requested effective result.`,
        nextRecommendedCommand,
        exitCode: ExitCode.Success,
        data: {
          amendmentId: null,
          checkpointId,
          workUnitId: workUnit.id,
          effectiveAcceptanceCriteriaResult: applied.effectiveAcceptanceCriteriaResult,
          effectiveValidationResult: applied.effectiveValidationResult,
          workUnitStatusBefore: applied.workUnitStatusBefore,
          workUnitStatusAfter: applied.workUnitStatusAfter,
          changed: false,
        },
      });
    }

    let currentMilestoneId = state.currentMilestoneId;
    if (
      applied.workUnitStatusAfter === "done" &&
      applied.workUnitStatusBefore === "needs_review" &&
      state.currentWorkUnitId === null
    ) {
      const nextReady = selectNextReadyWorkUnit({
        ...state,
        workGraph: { ...state.workGraph, workUnits: applied.workUnits },
      });
      currentMilestoneId = nextReady.milestone?.id ?? null;
    }

    const stateWithAmendment: StateModel = {
      ...state,
      projectStatus: applied.projectStatus,
      currentMilestoneId,
      workGraph: {
        ...state.workGraph,
        workUnits: applied.workUnits,
        milestones: applied.milestones,
      },
      checkpointAmendments: [...(state.checkpointAmendments ?? []), applied.amendment!],
      lastUpdatedAt: timestamp,
    };

    const review = runReview(project, stateWithAmendment, knownPacketIds);
    const nextRecommendedCommand = computeReviewNextCommand(
      project,
      stateWithAmendment,
      review.findings,
    );
    const finalState: StateModel = { ...stateWithAmendment, nextRecommendedCommand };
    writeStateModel(paths.stateFile, finalState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    appendRunlogEvent(
      paths.runlogFile,
      buildCheckpointAmendedEvent({
        id: eventId,
        timestamp,
        relatedIds: [checkpointId, workUnit.id],
        data: {
          amendmentId,
          checkpointId,
          workUnitId: workUnit.id,
          ...(acceptanceCriteriaResult !== undefined ? { acceptanceCriteriaResult } : {}),
          ...(validationResult !== undefined ? { validationResult } : {}),
          reason,
          sourceCommand: SOURCE_COMMAND,
        },
      }),
    );

    return makeResult({
      status: "passed",
      action: "checkpoint",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Checkpoint amendment stored for ${checkpointId}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Stored checkpoint amendment",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [checkpointId, workUnit.id],
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        amendmentId,
        checkpointId,
        workUnitId: workUnit.id,
        effectiveAcceptanceCriteriaResult: applied.effectiveAcceptanceCriteriaResult,
        effectiveValidationResult: applied.effectiveValidationResult,
        workUnitStatusBefore: applied.workUnitStatusBefore,
        workUnitStatusAfter: applied.workUnitStatusAfter,
        changed: true,
      },
    });
  } catch (err) {
    return errorToResult("checkpoint", err);
  }
}
