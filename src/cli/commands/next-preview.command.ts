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
import { resolveNextSelection } from "../../workflow/next-work-unit-selector.js";
import { runAgentHandoffGate } from "../../workflow/agent-handoff-gate.js";
import {
  parseSelectionRequest,
  buildActiveWorkUnitGuardResult,
  buildSelectionBlockedResult,
  buildCandidateReportingData,
  buildAlternativeCandidateGuidance,
  buildExecutionGuidanceForWorkUnit,
  type RawSelectionOptions,
} from "./next-selection-helpers.js";
import type { StateModel } from "../../schema/state.schema.js";

export type RunNextPreviewOptions = RawSelectionOptions;

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
 * aiqt next --preview (M9 §8.4, M20 §13): shows what aiqt next would select
 * without mutating state, setting current pointers, creating/updating
 * lastAgentPacket, or appending any runlog event (read-only). M20 adds
 * --work-unit/--milestone selectors, both usable with --preview; preview and
 * apply always call the same resolveNextSelection engine, so the selected
 * work unit is guaranteed identical for the same canonical state and
 * arguments.
 */
export function runNextPreview(
  ctx: CommandContext,
  options: RunNextPreviewOptions = {},
): CommandResult {
  try {
    const parsed = parseSelectionRequest(options, "NEXT-PREVIEW");
    if (!parsed.ok) return parsed.result;

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
        "NEXT-PREVIEW-NO-WORK-GRAPH",
      );
    }

    // M20 §7: the active-work-unit guard takes precedence over every
    // selection mode, including preview.
    if (state.currentWorkUnitId !== null) {
      return buildActiveWorkUnitGuardResult(state, "NEXT-PREVIEW");
    }

    const selection = resolveNextSelection(state, parsed.request);
    if (!selection.selectedWorkUnit) {
      // Preserve the exact pre-M20 issue id/message for default mode's
      // "nothing is ready" case; work_unit/milestone modes are new, so use
      // the richer M20 blocked-result builder for those instead.
      if (selection.mode === "default") {
        return blockedOnState(
          state,
          "No ready work unit exists. Run aiqt review.",
          "aiqt review",
          "NEXT-PREVIEW-NO-READY-WORK-UNIT",
        );
      }
      if (selection.blockingReason) {
        return buildSelectionBlockedResult(state, selection.blockingReason, "NEXT-PREVIEW");
      }
      return blockedOnState(
        state,
        "No ready work unit exists. Run aiqt review.",
        "aiqt review",
        "NEXT-PREVIEW-NO-READY-WORK-UNIT",
      );
    }
    const workUnit = selection.selectedWorkUnit;
    const milestone = selection.selectedMilestone;

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

    const alternativeGuidance = buildAlternativeCandidateGuidance(selection);

    return makeResult({
      status: packetGenerationAllowed ? "passed" : "warning",
      action: "next",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Preview: aiqt next would select work unit "${workUnit.id}".${alternativeGuidance ? ` ${alternativeGuidance}` : ""}`,
      nextRecommendedCommand: packetGenerationAllowed ? "aiqt next" : "aiqt review",
      exitCode: ExitCode.Success,
      data: {
        mutation: false,
        executionGuidance: buildExecutionGuidanceForWorkUnit(workUnit, paths.root),
        ...buildCandidateReportingData(selection),
        selectedMilestoneId: milestone?.id ?? null,
        readinessReason:
          selection.mode === "default"
            ? `Work unit "${workUnit.id}" is the first effectively ready work unit in stored order.`
            : `Work unit "${workUnit.id}" was explicitly selected and is effectively ready.`,
        satisfiedBlockingDependencies,
        sequencingWarnings,
        packetGenerationAllowed,
      },
    });
  } catch (err) {
    return errorToResult("next", err);
  }
}
