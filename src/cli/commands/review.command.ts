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
import {
  classifyFindings,
  findingsForMode,
  getAcknowledgedFindings,
  type FindingView,
} from "../../services/manage-service.js";
import { computeReviewNextCommand } from "../../workflow/review-next-command.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";
import { buildAdvisoryWarningsSection } from "../../workflow/checkpoint-advisory-visibility.js";

export type ReviewMode = "development" | "release";

export interface RunReviewOptions {
  mode?: string;
}

function findingToIssue(finding: FindingView): Issue {
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

/**
 * aiqt review --mode development|release (M9 §8.2). Default mode is
 * development, so `aiqt review` alone is equivalent to
 * `aiqt review --mode development`.
 */
export function runReviewCommand(
  ctx: CommandContext,
  options: RunReviewOptions = {},
): CommandResult {
  try {
    const mode = options.mode ?? "development";
    if (mode !== "development" && mode !== "release") {
      const message = `Unsupported review mode "${mode}". Use "development" or "release".`;
      return makeResult({
        status: "failed",
        action: "review",
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "REVIEW-INVALID-MODE",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }
    const reviewMode: ReviewMode = mode;

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

    const { paths, project, state, runlogHealth, warnings } = loadProject(ctx);

    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const result = runReview(project, state, knownPacketIds);
    const classification = classifyFindings(project, state, result);
    const acknowledgedRecords = getAcknowledgedFindings(state);

    // M9 §8.2: development mode ignores acknowledged blocking findings for
    // pass/fail purposes; release mode ignores acknowledgment entirely, so an
    // acknowledged finding can still block release. M10 §8.3/§9: release
    // mode's blocker set is now the full releaseBlockers bucket (blocking
    // review findings PLUS checkpoint-issue-derived release blockers such as
    // required live setup/verification, branch protection, or legal review),
    // so aiqt review --mode release stays consistent with aiqt
    // manage/final-review.md's productionReady classification.
    const modeBlockingFindings =
      reviewMode === "development"
        ? classification.unacknowledgedBlockingFindings
        : classification.blockingFindingsIgnoringAcknowledgment;
    const modeBlockingCount =
      reviewMode === "development"
        ? modeBlockingFindings.length
        : classification.releaseBlockers.length;
    const hasBlocking = modeBlockingCount > 0;

    // Checkpoint-issue-derived release blockers have no ReviewFinding to map
    // through findingToIssue; releaseBlockers is ordered
    // [...findingBased, ...issueBased], so the tail slice past
    // blockingFindingsIgnoringAcknowledgment.length is exactly the
    // issue-based entries.
    const releaseOnlyIssueBlockers =
      reviewMode === "release"
        ? classification.releaseBlockers.slice(classification.blockingFindingsIgnoringAcknowledgment.length)
        : [];

    const status: CommandStatus = hasBlocking
      ? "failed"
      : result.findingCount > 0
        ? "warning"
        : "passed";
    const exitCode = hasBlocking ? ExitCode.ValidationFailed : ExitCode.Success;

    const summary = hasBlocking
      ? `Review (${reviewMode} mode) completed with ${modeBlockingCount} blocking finding(s).`
      : result.findingCount > 0
        ? `Review (${reviewMode} mode) completed with non-blocking findings.`
        : `Review (${reviewMode} mode) completed with no findings.`;

    // Reuse the single authoritative next-command precedence, but only feed
    // it the findings that are actually blocking under this mode, so a fully
    // acknowledged development review can move past "aiqt review" to
    // whatever comes next (e.g. aiqt export all).
    const findingsForNextCommand = findingsForMode(result, acknowledgedRecords, reviewMode);
    const nextRecommendedCommand = computeReviewNextCommand(
      project,
      state,
      findingsForNextCommand,
    );

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
        ? [
            ...modeBlockingFindings.map(findingToIssue),
            ...releaseOnlyIssueBlockers.map(
              (label): Issue => ({
                id: "REVIEW-RELEASE-CHECKPOINT-ISSUE-BLOCKER",
                severity: "high",
                area: "checkpoint",
                message: label,
                agentCanFix: false,
              }),
            ),
          ]
        : [],
      warnings,
      nextRecommendedCommand,
      exitCode,
      data: {
        mode: reviewMode,
        findingCount: result.findingCount,
        blockingFindingCount: result.blockingFindingCount,
        warningFindingCount: result.warningFindingCount,
        infoFindingCount: result.infoFindingCount,
        recommendedExportTargets: result.recommendedExportTargets,
        activeFindings: classification.activeFindings,
        acknowledgedFindings: classification.acknowledgedFindings,
        developmentComplete: classification.developmentComplete,
        productionReady: classification.productionReady,
        findings: result.findings,
        runlogHealth,
        // M29 §4/§6: a separate, non-blocking section -- these warnings
        // never contribute to `status`, `exitCode`, or blockingIssues above.
        evidenceAdvisoryWarnings: buildAdvisoryWarningsSection(state),
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
