import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadProject } from "./load-project.js";
import { computeNextAction } from "../../workflow/next-action.js";
import { workUnitCountsByStatus } from "../../workflow/statuses.js";

export function runStatus(ctx: CommandContext): CommandResult {
  try {
    const { project, state, runlogHealth, warnings } = loadProject(ctx);

    const next = computeNextAction(project, state);
    const workUnitCounts = workUnitCountsByStatus(state);
    const milestoneCount = state.workGraph.milestones.length;
    const workUnitCount = state.workGraph.workUnits.length;

    const allWarnings = [...warnings, ...next.warnings];

    const summary = `Project "${project.project.name}" is ${state.projectStatus} with ${milestoneCount} milestone(s) and ${workUnitCount} work unit(s).`;

    return makeResult({
      status: allWarnings.length > 0 ? "warning" : "passed",
      action: "status",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary,
      warnings: allWarnings,
      nextRecommendedCommand: next.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        projectName: project.project.name,
        projectStatus: state.projectStatus,
        milestoneCount,
        workUnitCount,
        workUnitCounts,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        nextActionReason: next.reason,
        runlogHealth,
      },
    });
  } catch (err) {
    return errorToResult("status", err);
  }
}
