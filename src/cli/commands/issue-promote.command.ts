import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildIssuePromotedEvent,
  readAgentPacketIds,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { runReview } from "../../services/review-service.js";
import { applyWorkflowAssessmentToState } from "../../services/workflow-assessment-persistence.js";
import {
  buildNormalizedIssues,
  findNormalizedIssue,
  getIssuePromotions,
  isPromotable,
} from "../../services/issue-service.js";
import { applyIssuePromotion } from "../../workflow/repair-work-graph.js";
import type { IssuePromotion } from "../../schema/issue-state.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunIssuePromoteOptions {
  issueKey?: string;
  title?: string;
  reason?: string;
  validationCommands?: string[];
}

const SOURCE_COMMAND = "aiqt issue promote";

/**
 * Recompute projectStatus after adding a new ready repair work unit. Mirrors
 * the review/all-done convention used elsewhere; otherwise falls back to
 * whichever status already reflects whether work is actively in progress,
 * since promotion itself neither starts nor finishes any work unit.
 */
function recomputeProjectStatusAfterPromotion(
  workUnits: readonly { status: string }[],
  currentWorkUnitId: string | null,
  previousStatus: StateModel["projectStatus"],
): StateModel["projectStatus"] {
  if (workUnits.some((wu) => wu.status === "needs_review")) return "review";
  if (workUnits.length > 0 && workUnits.every((wu) => wu.status === "done")) return "review";
  if (currentWorkUnitId !== null) return "in_progress";
  if (previousStatus === "review" || previousStatus === "done") return "planned";
  return previousStatus;
}

function failInvalidInput(id: string, message: string): CommandResult {
  return makeResult({
    status: "failed",
    action: "issue",
    summary: message,
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [
      {
        id,
        severity: "high",
        area: "input",
        message,
        agentCanFix: false,
      },
    ],
  });
}

/**
 * aiqt issue promote <issue-key> --title --reason --validation-command
 * (M11 §14.4). Creates (or reuses) a canonical repair work unit; never uses
 * M-REPAIR. Duplicate promotion is an idempotent success returning the
 * existing work unit id.
 */
export function runIssuePromote(
  ctx: CommandContext,
  options: RunIssuePromoteOptions,
): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "issue",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "ISSUE-PROMOTE-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const issueKey = (options.issueKey ?? "").trim();
    if (issueKey === "") {
      return failInvalidInput(
        "ISSUE-PROMOTE-MISSING-KEY",
        'An issue-key is required: aiqt issue promote <issue-key> --title "..." --reason "..." --validation-command "..."',
      );
    }

    const title = (options.title ?? "").trim();
    if (title === "") {
      return failInvalidInput("ISSUE-PROMOTE-MISSING-TITLE", "--title is required and must be non-empty.");
    }

    const reason = (options.reason ?? "").trim();
    if (reason === "") {
      return failInvalidInput("ISSUE-PROMOTE-MISSING-REASON", "--reason is required and must be non-empty.");
    }

    const suppliedValidationCommands = (options.validationCommands ?? [])
      .map((c) => c.trim())
      .filter((c) => c !== "");
    if ((options.validationCommands ?? []).length > 0 && suppliedValidationCommands.length === 0) {
      return failInvalidInput(
        "ISSUE-PROMOTE-INVALID-VALIDATION-COMMAND",
        "--validation-command values must be non-empty.",
      );
    }

    const { paths, project, state } = loadProject(ctx);
    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const review = runReview(project, state, knownPacketIds);
    const issues = buildNormalizedIssues(state, review);
    const issue = findNormalizedIssue(issueKey, issues);

    if (!issue) {
      const message = `Issue key "${issueKey}" does not match any known checkpoint issue or blocking review finding.`;
      return makeResult({
        status: "failed",
        action: "issue",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt issue list",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "ISSUE-PROMOTE-UNKNOWN-KEY",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const promotions = getIssuePromotions(state);

    // Idempotent success: already-promoted issues return the existing link.
    if (issue.promotedWorkUnitId !== null) {
      const existingPromotion = promotions.find((p) => p.issueKey === issueKey);
      return makeResult({
        status: "passed",
        action: "issue",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Issue "${issueKey}" was already promoted to work unit ${issue.promotedWorkUnitId}.`,
        nextRecommendedCommand: "aiqt next",
        exitCode: ExitCode.Success,
        data: {
          issueKey,
          promoted: true,
          alreadyPromoted: true,
          workUnitId: issue.promotedWorkUnitId,
          milestoneId: existingPromotion?.milestoneId ?? null,
          nextRecommendedCommand: "aiqt next",
        },
      });
    }

    if (!isPromotable(issue)) {
      const message = `Issue "${issueKey}" is not promotable (it must be agent-fixable or release-blocking, and not already resolved).`;
      return makeResult({
        status: "blocked",
        action: "issue",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt issue list",
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "ISSUE-PROMOTE-NOT-PROMOTABLE",
            severity: "medium",
            area: "workflow",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const preferredValidationCommands = project.quality.preferredValidationCommands.filter(
      (c) => c.trim() !== "",
    );
    const validationCommands =
      suppliedValidationCommands.length > 0
        ? suppliedValidationCommands
        : preferredValidationCommands;

    if (validationCommands.length === 0) {
      const message =
        "No validation commands could be resolved. Provide at least one --validation-command, or set project.quality.preferredValidationCommands.";
      return makeResult({
        status: "blocked",
        action: "issue",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt issue promote",
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "ISSUE-PROMOTE-NO-VALIDATION-COMMANDS",
            severity: "medium",
            area: "workflow",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const timestamp = new Date().toISOString();
    const promotionResult = applyIssuePromotion({
      workGraph: state.workGraph,
      title,
      issueMessage: issue.message,
      validationCommands,
      timestamp,
    });

    const newPromotion: IssuePromotion = {
      issueKey,
      workUnitId: promotionResult.workUnit.id,
      milestoneId: promotionResult.milestone.id,
      promotedAt: timestamp,
      sourceCommand: SOURCE_COMMAND,
    };

    const stateWithPromotion: StateModel = {
      ...state,
      projectStatus: recomputeProjectStatusAfterPromotion(
        promotionResult.workGraph.workUnits,
        state.currentWorkUnitId,
        state.projectStatus,
      ),
      workGraph: promotionResult.workGraph,
      issues: {
        overrides: state.issues?.overrides ?? [],
        promotions: [...promotions, newPromotion],
      },
      lastUpdatedAt: timestamp,
    };

    const finalState: StateModel = applyWorkflowAssessmentToState(project, stateWithPromotion);
    const nextRecommendedCommand = finalState.nextRecommendedCommand ?? "aiqt review";
    writeStateModel(paths.stateFile, finalState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    appendRunlogEvent(
      paths.runlogFile,
      buildIssuePromotedEvent({
        id: eventId,
        timestamp,
        relatedIds: [issue.workUnitId, promotionResult.workUnit.id, promotionResult.milestone.id].filter(
          (id): id is string => id !== null,
        ),
        data: {
          issueKey,
          workUnitId: promotionResult.workUnit.id,
          milestoneId: promotionResult.milestone.id,
          title,
          sourceCommand: SOURCE_COMMAND,
        },
      }),
    );

    return makeResult({
      status: "passed",
      action: "issue",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Promoted issue ${issueKey} to work unit ${promotionResult.workUnit.id}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        promotionResult.milestoneCreated
          ? `Created repair milestone ${promotionResult.milestone.id}`
          : `Reused repair milestone ${promotionResult.milestone.id}`,
        `Created work unit ${promotionResult.workUnit.id}`,
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [promotionResult.workUnit.id, promotionResult.milestone.id],
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        issueKey,
        promoted: true,
        alreadyPromoted: false,
        workUnitId: promotionResult.workUnit.id,
        milestoneId: promotionResult.milestone.id,
        nextRecommendedCommand,
      },
    });
  } catch (err) {
    return errorToResult("issue", err);
  }
}
