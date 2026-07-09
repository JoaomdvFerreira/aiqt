import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { AiqtError } from "../../core/output/aiqt-error.js";
import type { Issue } from "../../core/output/issue.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import {
  readJsonFile,
  FileReadError,
  JsonParseError,
} from "../../core/filesystem/file-store.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildCheckpointCreatedEvent,
  buildWorkUnitStatusChangedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import {
  CheckpointInputSchema,
  type CheckpointInput,
} from "../../schema/checkpoint-input.schema.js";
import { applyCheckpoint } from "../../services/checkpoint-service.js";
import { isPlanningContextReady } from "../../workflow/planning-readiness.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { WorkUnit } from "../../schema/work-unit.schema.js";

function blockedOnState(
  state: StateModel,
  summary: string,
  nextRecommendedCommand: string,
  issueId: string,
): CommandResult {
  return makeResult({
    status: "blocked",
    action: "checkpoint",
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

function failedOnState(
  state: StateModel,
  summary: string,
  nextRecommendedCommand: string | null,
  exitCode: number,
  issueOrId: Issue | string,
): CommandResult {
  const issue: Issue =
    typeof issueOrId === "string"
      ? {
          id: issueOrId,
          severity: "high",
          area: "workflow",
          message: summary,
          agentCanFix: false,
        }
      : issueOrId;
  return makeResult({
    status: "failed",
    action: "checkpoint",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary,
    nextRecommendedCommand,
    exitCode,
    blockingIssues: [issue],
  });
}

function loadCheckpointInputFromFile(path: string): CheckpointInput {
  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      throw new AiqtError(err.message, ExitCode.InvalidInput, {
        id: "CHECKPOINT-FROM-FILE-INVALID",
        severity: "critical",
        area: "input",
        message: err.message,
        agentCanFix: false,
      });
    }
    throw err;
  }

  const parsed = CheckpointInputSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid checkpoint input: ${parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ")}`;
    throw new AiqtError(message, ExitCode.InvalidInput, {
      id: "CHECKPOINT-INPUT-SCHEMA-INVALID",
      severity: "critical",
      area: "input",
      message,
      agentCanFix: false,
    });
  }
  return parsed.data;
}

export interface RunCheckpointOptions {
  fromFile?: string;
}

export function runCheckpoint(
  ctx: CommandContext,
  options: RunCheckpointOptions,
): CommandResult {
  try {
    // .aiqt/ missing has a specific next-command hint ("aiqt init") per the
    // M5 error table; the generic AiqtError -> errorToResult path used for
    // other failures below always leaves nextRecommendedCommand null.
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "checkpoint",
        summary:
          "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-NO-PROJECT",
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

    const hasWorkGraph = state.workGraph.milestones.length > 0;
    if (!hasWorkGraph) {
      const ready = isPlanningContextReady(project);
      return blockedOnState(
        state,
        ready
          ? "Project context is ready, but no work graph exists yet. Run aiqt plan to generate the work graph."
          : "Project context is not ready for planning. Run aiqt update to capture more context.",
        ready ? "aiqt plan" : "aiqt update",
        "CHECKPOINT-NO-WORK-GRAPH",
      );
    }

    if (state.currentWorkUnitId === null) {
      return blockedOnState(
        state,
        "No work unit is currently in progress. Run aiqt next to select one.",
        "aiqt next",
        "CHECKPOINT-NO-CURRENT-WORK-UNIT",
      );
    }

    const workUnit: WorkUnit | undefined = state.workGraph.workUnits.find(
      (wu) => wu.id === state.currentWorkUnitId,
    );
    if (!workUnit) {
      return failedOnState(
        state,
        `currentWorkUnitId "${state.currentWorkUnitId}" does not reference an existing work unit.`,
        "aiqt next",
        ExitCode.InvalidInput,
        "CHECKPOINT-UNKNOWN-WORK-UNIT",
      );
    }

    if (workUnit.status !== "in_progress") {
      return failedOnState(
        state,
        `Current work unit "${workUnit.id}" does not have status in_progress (found "${workUnit.status}").`,
        "aiqt next",
        ExitCode.InvalidInput,
        "CHECKPOINT-WORK-UNIT-NOT-IN-PROGRESS",
      );
    }

    if (!state.lastAgentPacket || state.lastAgentPacket.workUnitId !== workUnit.id) {
      return failedOnState(
        state,
        "No agent packet metadata references the current work unit. Run aiqt next to regenerate a packet.",
        "aiqt next",
        ExitCode.InvalidInput,
        "CHECKPOINT-PACKET-MISMATCH",
      );
    }

    if (!options.fromFile) {
      return makeResult({
        status: "needs_input",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary:
          "No checkpoint input file supplied. Provide a structured checkpoint result via --from-file.",
        requiresHumanInput: true,
        nextRecommendedCommand: "aiqt checkpoint --from-file <path>",
        exitCode: ExitCode.HumanInputRequired,
      });
    }

    const retryHint = `aiqt checkpoint --from-file ${options.fromFile}`;

    let result;
    try {
      const input = loadCheckpointInputFromFile(options.fromFile);
      const timestamp = new Date().toISOString();
      const checkpointId = nextId("C", state.checkpoints.map((c) => c.id), "");
      result = {
        applied: applyCheckpoint({ state, workUnit, input, checkpointId, timestamp }),
        timestamp,
      };
    } catch (err) {
      if (err instanceof AiqtError) {
        return failedOnState(
          state,
          err.message,
          retryHint,
          err.exitCode,
          err.issue ?? "CHECKPOINT-FAILED",
        );
      }
      throw err;
    }

    const { applied, timestamp } = result;

    const newState: StateModel = {
      ...state,
      projectStatus: applied.projectStatus,
      currentMilestoneId: applied.currentMilestoneId,
      currentWorkUnitId: null,
      workGraph: {
        ...state.workGraph,
        workUnits: applied.workUnits,
        milestones: applied.milestones,
      },
      checkpoints: [...state.checkpoints, applied.checkpoint],
      nextRecommendedCommand: applied.nextRecommendedCommand,
      lastUpdatedAt: timestamp,
    };

    writeStateModel(paths.stateFile, newState);

    let eventIds = readRunlogEventIds(paths.runlogFile);
    const checkpointEventId = nextId("EVT", eventIds);
    eventIds = [...eventIds, checkpointEventId];

    const changedFiles = [paths.stateFile, paths.runlogFile];
    const relatedIds = [
      project.project.id,
      workUnit.milestoneId,
      workUnit.id,
      applied.checkpoint.id,
      ...(applied.checkpoint.packetId ? [applied.checkpoint.packetId] : []),
    ];

    appendRunlogEvent(
      paths.runlogFile,
      buildCheckpointCreatedEvent({
        id: checkpointEventId,
        timestamp,
        relatedIds,
        data: {
          checkpointId: applied.checkpoint.id,
          workUnitId: workUnit.id,
          packetId: applied.checkpoint.packetId,
          validationResult: applied.checkpoint.validationResult,
          acceptanceCriteriaResult: applied.checkpoint.acceptanceCriteriaResult,
          targetStatus: applied.checkpoint.finalWorkUnitStatus,
          nextRecommendedCommand: applied.nextRecommendedCommand,
        },
      }),
    );

    const selectedEventId = nextId("EVT", eventIds);
    eventIds = [...eventIds, selectedEventId];
    appendRunlogEvent(
      paths.runlogFile,
      buildWorkUnitStatusChangedEvent({
        id: selectedEventId,
        timestamp,
        relatedIds: [
          project.project.id,
          workUnit.milestoneId,
          workUnit.id,
          applied.checkpoint.id,
        ],
        data: {
          workUnitId: workUnit.id,
          fromStatus: "in_progress",
          toStatus: applied.checkpoint.finalWorkUnitStatus,
          reason: "Checkpoint captured.",
        },
      }),
    );

    for (const readyId of applied.newlyReadyWorkUnitIds) {
      const readyWorkUnit = applied.workUnits.find((wu) => wu.id === readyId)!;
      const eventId = nextId("EVT", eventIds);
      eventIds = [...eventIds, eventId];
      appendRunlogEvent(
        paths.runlogFile,
        buildWorkUnitStatusChangedEvent({
          id: eventId,
          timestamp,
          relatedIds: [
            project.project.id,
            readyWorkUnit.milestoneId,
            readyWorkUnit.id,
            applied.checkpoint.id,
          ],
          data: {
            workUnitId: readyId,
            fromStatus: "planned",
            toStatus: "ready",
            reason: "Unblocked by dependency completion.",
          },
        }),
      );
    }

    return makeResult({
      status: "passed",
      action: "checkpoint",
      projectStatus: applied.projectStatus,
      currentMilestoneId: applied.currentMilestoneId,
      currentWorkUnitId: null,
      summary: `Checkpoint captured for ${workUnit.id}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Created checkpoint",
        "Updated workflow state",
        "Appended runlog events",
      ],
      changedFiles,
      affectedItems: [
        project.project.id,
        workUnit.milestoneId,
        workUnit.id,
        applied.checkpoint.id,
      ],
      nextRecommendedCommand: applied.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        checkpointId: applied.checkpoint.id,
        workUnitId: workUnit.id,
        packetId: applied.checkpoint.packetId,
        fromStatus: "in_progress",
        toStatus: applied.checkpoint.finalWorkUnitStatus,
        validationResult: applied.checkpoint.validationResult,
        acceptanceCriteriaResult: applied.checkpoint.acceptanceCriteriaResult,
        newlyReadyWorkUnitIds: applied.newlyReadyWorkUnitIds,
        nextReadyWorkUnitId: applied.nextReadyWorkUnitId,
      },
    });
  } catch (err) {
    return errorToResult("checkpoint", err);
  }
}
