import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { AiqtError } from "../../core/output/aiqt-error.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { isPlanningContextReady } from "../../workflow/planning-readiness.js";
import { selectNextReadyWorkUnit } from "../../workflow/next-work-unit-selector.js";
import { runAgentHandoffGate } from "../../workflow/agent-handoff-gate.js";
import type { StateModel } from "../../schema/state.schema.js";

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

/**
 * aiqt next --preview (M9 §8.4): shows what aiqt next would select without
 * mutating state, setting current pointers, creating/updating
 * lastAgentPacket, or appending any runlog event (read-only).
 */
export function runNextPreview(ctx: CommandContext): CommandResult {
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
            id: "NEXT-PREVIEW-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const { project, state } = loadProject(ctx);

    const hasWorkGraph = state.workGraph.milestones.length > 0;
    if (!hasWorkGraph) {
      const ready = isPlanningContextReady(project);
      return blockedOnState(
        state,
        ready
          ? "Project context is ready, but no work graph exists yet. Run aiqt plan to generate the work graph."
          : "Project context is not ready for planning. Run aiqt update to capture more context.",
        ready ? "aiqt plan" : "aiqt update",
        "NEXT-PREVIEW-NO-WORK-GRAPH",
      );
    }

    if (state.currentWorkUnitId !== null) {
      return blockedOnState(
        state,
        "A work unit is already in progress. Run aiqt checkpoint before starting another.",
        "aiqt checkpoint",
        "NEXT-PREVIEW-WORK-UNIT-IN-PROGRESS",
      );
    }

    const { workUnit, milestone } = selectNextReadyWorkUnit(state);
    if (!workUnit) {
      return blockedOnState(
        state,
        "No ready work unit exists. Run aiqt review.",
        "aiqt review",
        "NEXT-PREVIEW-NO-READY-WORK-UNIT",
      );
    }

    let packetGenerationAllowed = true;
    const sequencingWarnings: string[] = [];
    try {
      runAgentHandoffGate(workUnit, milestone, state);
    } catch (err) {
      if (err instanceof AiqtError) {
        packetGenerationAllowed = false;
        sequencingWarnings.push(err.message);
      } else {
        throw err;
      }
    }

    const satisfiedBlockingDependencies = workUnit.dependencies
      .map((depId) => state.workGraph.dependencies.find((d) => d.id === depId))
      .filter(
        (d): d is NonNullable<typeof d> =>
          d !== undefined && (d.type === "blocks" || d.type === "requires"),
      )
      .map((d) => ({ id: d.id, fromId: d.fromId, toId: d.toId, type: d.type }));

    return makeResult({
      status: packetGenerationAllowed ? "passed" : "warning",
      action: "next",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Preview: aiqt next would select work unit "${workUnit.id}".`,
      nextRecommendedCommand: packetGenerationAllowed ? "aiqt next" : "aiqt review",
      exitCode: ExitCode.Success,
      data: {
        mutation: false,
        selectedWorkUnitId: workUnit.id,
        selectedMilestoneId: milestone?.id ?? null,
        readinessReason: `Work unit "${workUnit.id}" is the first ready work unit in stored order.`,
        satisfiedBlockingDependencies,
        sequencingWarnings,
        packetGenerationAllowed,
      },
    });
  } catch (err) {
    return errorToResult("next", err);
  }
}
