import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
  type CommandStatus,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { Issue, IssueSeverity } from "../../core/output/issue.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { runReview } from "../../services/review-service.js";
import type { ReviewFinding } from "../../schema/review-finding.schema.js";

function findingToIssue(finding: ReviewFinding): Issue {
  const severity: IssueSeverity = finding.severity === "info" ? "low" : finding.severity;
  return {
    id: finding.id,
    severity,
    area: finding.category,
    message: finding.message,
    affectedItems: finding.relatedIds,
    suggestedAction: finding.suggestedAction,
    agentCanFix: false,
  };
}

export function runReviewCommand(ctx: CommandContext): CommandResult {
  try {
    // .aiqt/ missing has a specific next-command hint ("aiqt init") per the
    // M6 error table; the generic AiqtError -> errorToResult path used for
    // other pre-state failures below always leaves nextRecommendedCommand
    // null.
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "review",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "REVIEW-NO-PROJECT",
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

    const result = runReview(project, state);
    const hasBlocking = result.blockingFindingCount > 0;

    const status: CommandStatus = hasBlocking
      ? "failed"
      : result.findingCount > 0
        ? "warning"
        : "passed";
    const exitCode = hasBlocking ? ExitCode.ValidationFailed : ExitCode.Success;

    const summary = hasBlocking
      ? `Review completed with ${result.blockingFindingCount} blocking finding(s).`
      : result.findingCount > 0
        ? "Review completed with non-blocking workflow findings."
        : "Review completed with no findings.";

    return makeResult({
      status,
      action: "review",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary,
      completedActions: ["Read project.json", "Read state.json", "Evaluated review rules"],
      changedFiles: [],
      affectedItems: [project.project.id],
      blockingIssues: hasBlocking
        ? result.findings.filter((f) => f.blocking).map(findingToIssue)
        : [],
      warnings,
      nextRecommendedCommand: result.nextRecommendedCommand,
      exitCode,
      data: {
        findingCount: result.findingCount,
        blockingFindingCount: result.blockingFindingCount,
        warningFindingCount: result.warningFindingCount,
        infoFindingCount: result.infoFindingCount,
        recommendedExportTargets: result.recommendedExportTargets,
        findings: result.findings,
        runlogHealth,
      },
    });
  } catch (err) {
    // project.json/state.json invalid, unsupported schema version, or
    // unreadable runlog.jsonl: no state was successfully loaded, so there is
    // no basis for a specific next-command hint (matches "or null" in the
    // M6 error table).
    return errorToResult("review", err);
  }
}
