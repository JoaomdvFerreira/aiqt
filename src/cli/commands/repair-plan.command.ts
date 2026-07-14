import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";
import { runReview } from "../../services/review-service.js";
import { buildNormalizedIssues, isPromotable } from "../../services/issue-service.js";

export interface RepairPlanRecommendation {
  issueKey: string;
  title: string;
  promotable: boolean;
  recommendedCommand: string;
}

export interface RepairPlanData {
  recommendedRepairs: RepairPlanRecommendation[];
}

/**
 * aiqt repair plan (M11 §14.3): read-only, deterministic recommendation
 * list of promotable issues. The recommendedCommand is fully substituted
 * (copy-paste-runnable), matching the established convention of every other
 * nextRecommendedCommand/recommendedCommand field in this CLI -- a
 * deliberate deviation from the spec's illustrative `<issue-key>` placeholder.
 */
export function runRepairPlan(ctx: CommandContext): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "repair",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "REPAIR-PLAN-NO-PROJECT",
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
    const issues = buildNormalizedIssues(state, review);

    const recommendedRepairs: RepairPlanRecommendation[] = issues
      .filter((issue) => issue.promotedWorkUnitId === null && isPromotable(issue))
      .map((issue) => ({
        issueKey: issue.issueKey,
        title: issue.message,
        promotable: true,
        recommendedCommand: `aiqt issue promote ${issue.issueKey}`,
      }));

    return makeResult({
      status: "passed",
      action: "repair",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `${recommendedRepairs.length} promotable repair(s) recommended.`,
      exitCode: ExitCode.Success,
      data: { recommendedRepairs },
    });
  } catch (err) {
    return errorToResult("repair", err);
  }
}
