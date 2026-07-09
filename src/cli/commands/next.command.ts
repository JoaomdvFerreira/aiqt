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
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildAgentPacketCreatedEvent,
  buildWorkUnitStatusChangedEvent,
  readRunlogEventIds,
  readAgentPacketIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { sha256Hex } from "../../core/util/hash.js";
import { isPlanningContextReady } from "../../workflow/planning-readiness.js";
import { selectNextReadyWorkUnit } from "../../workflow/next-work-unit-selector.js";
import { runAgentHandoffGate } from "../../workflow/agent-handoff-gate.js";
import { applyWorkUnitStartTransition } from "../../workflow/status-transitions.js";
import {
  resolveAgentContextRefs,
  buildUnresolvedRefWarnings,
  buildPacketContext,
} from "../../services/agent-packet-service.js";
import { renderAgentPacket } from "../../services/agent-packet-template.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { AgentPacketMetadata } from "../../schema/agent-packet.schema.js";

function blockedOnState(
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

export function runNext(ctx: CommandContext): CommandResult {
  try {
    // .aiqt/ missing has a specific next-command hint ("aiqt init") per the
    // M4 error table; the generic AiqtError -> errorToResult path used for
    // other failures below always leaves nextRecommendedCommand null.
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "next",
        summary:
          "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "NEXT-NO-PROJECT",
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
        "NEXT-NO-WORK-GRAPH",
      );
    }

    if (state.currentWorkUnitId !== null) {
      return blockedOnState(
        state,
        "A work unit is already in progress. Run aiqt checkpoint before starting another.",
        "aiqt checkpoint",
        "NEXT-WORK-UNIT-IN-PROGRESS",
      );
    }

    const { workUnit, milestone } = selectNextReadyWorkUnit(state);
    if (!workUnit) {
      return blockedOnState(
        state,
        "No ready work unit exists. Run aiqt review.",
        "aiqt review",
        "NEXT-NO-READY-WORK-UNIT",
      );
    }

    try {
      runAgentHandoffGate(workUnit, milestone, state);
    } catch (err) {
      if (err instanceof AiqtError) {
        return makeResult({
          status: "failed",
          action: "next",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: err.message,
          nextRecommendedCommand: "aiqt review",
          exitCode: err.exitCode,
          blockingIssues: err.issue ? [err.issue] : [],
        });
      }
      throw err;
    }

    // The gate guarantees milestone is non-null and matches workUnit.milestoneId.
    const selectedMilestone = milestone!;

    const resolved = resolveAgentContextRefs(workUnit.agentContextRefs, project);
    const warnings: Issue[] = buildUnresolvedRefWarnings(resolved.unresolvedRefs);

    const packetContext = buildPacketContext(
      project,
      state,
      workUnit,
      selectedMilestone,
      resolved,
    );
    const packetBody = renderAgentPacket(packetContext);
    const contentHash = sha256Hex(packetBody);

    const timestamp = new Date().toISOString();
    const existingPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const packetId = nextId("PKT", existingPacketIds, "-");

    const packetMetadata: AgentPacketMetadata = {
      id: packetId,
      workUnitId: workUnit.id,
      milestoneId: selectedMilestone.id,
      createdAt: timestamp,
      format: "markdown",
      contentHash,
      sourceCommand: "aiqt next",
    };

    const transition = applyWorkUnitStartTransition(
      state,
      workUnit.id,
      selectedMilestone.id,
      timestamp,
    );

    const newState: StateModel = {
      ...state,
      projectStatus: "in_progress",
      currentMilestoneId: selectedMilestone.id,
      currentWorkUnitId: workUnit.id,
      workGraph: {
        ...state.workGraph,
        workUnits: transition.workUnits,
        milestones: transition.milestones,
      },
      lastAgentPacket: packetMetadata,
      nextRecommendedCommand: "aiqt checkpoint",
      lastUpdatedAt: timestamp,
    };

    writeStateModel(paths.stateFile, newState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const packetEventId = nextId("EVT", eventIds);
    const relatedIds = [
      project.project.id,
      selectedMilestone.id,
      workUnit.id,
      packetId,
    ];
    appendRunlogEvent(
      paths.runlogFile,
      buildAgentPacketCreatedEvent({
        id: packetEventId,
        timestamp,
        relatedIds,
        data: {
          packetId,
          workUnitId: workUnit.id,
          milestoneId: selectedMilestone.id,
          format: "markdown",
          contentHash,
          nextRecommendedCommand: "aiqt checkpoint",
        },
      }),
    );

    const statusEventId = nextId("EVT", [...eventIds, packetEventId]);
    appendRunlogEvent(
      paths.runlogFile,
      buildWorkUnitStatusChangedEvent({
        id: statusEventId,
        timestamp,
        relatedIds: [project.project.id, selectedMilestone.id, workUnit.id],
        data: {
          workUnitId: workUnit.id,
          fromStatus: "ready",
          toStatus: "in_progress",
          reason: "Selected by aiqt next.",
        },
      }),
    );

    return makeResult({
      status: warnings.length > 0 ? "warning" : "passed",
      action: "next",
      projectStatus: "in_progress",
      currentMilestoneId: selectedMilestone.id,
      currentWorkUnitId: workUnit.id,
      summary: `Agent packet created for ${workUnit.id}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Selected ready work unit",
        "Generated agent packet",
        "Updated workflow state",
        "Appended runlog events",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [project.project.id, selectedMilestone.id, workUnit.id, packetId],
      warnings,
      nextRecommendedCommand: "aiqt checkpoint",
      exitCode: ExitCode.Success,
      data: {
        packetId,
        workUnitId: workUnit.id,
        milestoneId: selectedMilestone.id,
        packetFormat: "markdown" as const,
        contentHash,
        packet: packetBody,
        statusChanges: [
          { entityType: "workUnit", id: workUnit.id, from: "ready", to: "in_progress" },
          {
            entityType: "milestone",
            id: selectedMilestone.id,
            from: selectedMilestone.status,
            to: "in_progress",
          },
        ],
      },
    });
  } catch (err) {
    return errorToResult("next", err);
  }
}
