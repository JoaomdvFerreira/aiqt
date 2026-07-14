import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { runReview } from "../../services/review-service.js";
import { buildManageReport } from "../../services/manage-service.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";

/**
 * aiqt manage (M9 §8.1): a read-only project manager report. Never mutates
 * state and never appends a runlog event.
 */
export function runManage(ctx: CommandContext): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "manage",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "MANAGE-NO-PROJECT",
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
    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const review = runReview(project, state, knownPacketIds);
    const report = buildManageReport(project, state, review);

    return makeResult({
      status: "passed",
      action: "manage",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: report.reason,
      completedActions: ["Read project.json", "Read state.json", "Evaluated review rules"],
      changedFiles: [],
      affectedItems: [project.project.id],
      nextRecommendedCommand: report.recommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        projectName: project.project.name,
        ...report,
      },
    });
  } catch (err) {
    return errorToResult("manage", err);
  }
}
