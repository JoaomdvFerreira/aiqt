import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { runReview } from "../../services/review-service.js";
import { buildManageReport } from "../../services/manage-service.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";
import { resolveRoots } from "../../workflow/root-resolution.js";
import { buildAdvisoryWarningsSection } from "../../workflow/checkpoint-advisory-visibility.js";

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
    // M16 §10: aiqt manage displays a root summary alongside the review report.
    const roots = resolveRoots({
      controlRoot: paths.root,
      existingRepositoryPath: project.project.existingRepositoryPath,
    });

    // M29 §6: "Expose advisory counts and a secondary suggested action. Do
    // not replace the existing primary next action or readiness
    // classification." -- report.recommendedCommand/nextRecommendedCommand
    // below are entirely unaffected by this.
    const advisoryWarnings = buildAdvisoryWarningsSection(state);
    const evidenceAdvisory = {
      warningCount: advisoryWarnings.length,
      warnings: advisoryWarnings,
      ...(advisoryWarnings.length > 0
        ? { suggestedAction: `aiqt evidence gate advisory refresh --checkpoint ${advisoryWarnings[0].checkpointId}` }
        : {}),
    };

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
        roots,
        ...report,
        evidenceAdvisory,
      },
    });
  } catch (err) {
    return errorToResult("manage", err);
  }
}
