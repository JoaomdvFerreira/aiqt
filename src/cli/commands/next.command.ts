import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { computeNextAction } from "../../workflow/next-action.js";

export function runNext(ctx: CommandContext): CommandResult {
  try {
    // .aiqt/ missing is a workflow block: the user must run aiqt init first.
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "blocked",
        action: "next",
        summary:
          "No AIQT project found. Run aiqt init to create the canonical state files.",
        exitCode: ExitCode.WorkflowBlocked,
        nextRecommendedCommand: "aiqt init",
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

    const { project, state, runlogHealth, warnings } = loadProject(ctx);
    const next = computeNextAction(project, state);
    const allWarnings = [...warnings, ...next.warnings];

    return makeResult({
      status: allWarnings.length > 0 ? "warning" : "passed",
      action: "next",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: next.reason,
      warnings: allWarnings,
      nextRecommendedCommand: next.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        nextRecommendedCommand: next.nextRecommendedCommand,
        reason: next.reason,
        runlogHealth,
      },
    });
  } catch (err) {
    return errorToResult("next", err);
  }
}
