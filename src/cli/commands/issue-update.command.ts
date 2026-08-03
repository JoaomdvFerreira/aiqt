import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildIssueUpdatedEvent,
  readAgentPacketIds,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { runReview } from "../../services/review-service.js";
import { applyWorkflowAssessmentToState } from "../../services/workflow-assessment-persistence.js";
import {
  buildNormalizedIssues,
  findNormalizedIssue,
  getIssueOverrides,
  findIssueOverride,
} from "../../services/issue-service.js";
import { IssueOverrideStatusSchema, type IssueOverride } from "../../schema/issue-state.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunIssueUpdateOptions {
  issueKey?: string;
  status?: string;
  reason?: string;
}

const SOURCE_COMMAND = "aiqt issue update";

function relatedIdsForIssue(issueKey: string, workUnitId: string | null): string[] {
  return workUnitId ? [workUnitId] : [issueKey];
}

/**
 * aiqt issue update <issue-key> --status <status> --reason "..." (M11 §14.2).
 * Stores a status override without rewriting the source checkpoint issue or
 * review finding. Missing args and unknown keys are InvalidInput (3), never
 * HumanInputRequired.
 */
export function runIssueUpdate(
  ctx: CommandContext,
  options: RunIssueUpdateOptions,
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
            id: "ISSUE-UPDATE-NO-PROJECT",
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
      const message = 'An issue-key is required: aiqt issue update <issue-key> --status <status> --reason "..."';
      return makeResult({
        status: "failed",
        action: "issue",
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "ISSUE-UPDATE-MISSING-KEY",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const statusParse = IssueOverrideStatusSchema.safeParse(options.status);
    if (!statusParse.success) {
      const message = `--status is required and must be one of: ${IssueOverrideStatusSchema.options.join(", ")}.`;
      return makeResult({
        status: "failed",
        action: "issue",
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "ISSUE-UPDATE-INVALID-STATUS",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }
    const status = statusParse.data;

    const reason = (options.reason ?? "").trim();
    if (reason === "") {
      const message = "--reason is required and must be non-empty.";
      return makeResult({
        status: "failed",
        action: "issue",
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "ISSUE-UPDATE-MISSING-REASON",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
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
            id: "ISSUE-UPDATE-UNKNOWN-KEY",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (issue.promotedWorkUnitId !== null) {
      const message = `Issue "${issueKey}" has already been promoted to work unit ${issue.promotedWorkUnitId} and its status can no longer be overridden.`;
      return makeResult({
        status: "blocked",
        action: "issue",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt repair plan",
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "ISSUE-UPDATE-ALREADY-PROMOTED",
            severity: "medium",
            area: "workflow",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const overrides = getIssueOverrides(state);
    const existing = findIssueOverride(issueKey, overrides);

    // Idempotent no-op: re-applying the same status+reason stores no second
    // record and appends no second runlog event.
    if (existing && existing.status === status && existing.reason === reason) {
      const assessedState = applyWorkflowAssessmentToState(project, state);
      const nextRecommendedCommand = assessedState.nextRecommendedCommand ?? "aiqt review";
      return makeResult({
        status: "passed",
        action: "issue",
        projectStatus: assessedState.projectStatus,
        currentMilestoneId: assessedState.currentMilestoneId,
        currentWorkUnitId: assessedState.currentWorkUnitId,
        summary: `Issue "${issueKey}" is already set to ${status}.`,
        nextRecommendedCommand,
        exitCode: ExitCode.Success,
        data: { issueKey, status, reason, changed: false, nextRecommendedCommand },
      });
    }

    const timestamp = new Date().toISOString();
    const newOverride: IssueOverride = {
      issueKey,
      status,
      reason,
      updatedAt: timestamp,
      sourceCommand: SOURCE_COMMAND,
    };
    const updatedOverrides = [...overrides.filter((o) => o.issueKey !== issueKey), newOverride];

    const newState: StateModel = {
      ...state,
      issues: {
        overrides: updatedOverrides,
        promotions: state.issues?.promotions ?? [],
      },
      lastUpdatedAt: timestamp,
    };

    const finalState: StateModel = applyWorkflowAssessmentToState(project, newState);
    const nextRecommendedCommand = finalState.nextRecommendedCommand ?? "aiqt review";
    writeStateModel(paths.stateFile, finalState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    const relatedIds = relatedIdsForIssue(issueKey, issue.workUnitId);
    appendRunlogEvent(
      paths.runlogFile,
      buildIssueUpdatedEvent({
        id: eventId,
        timestamp,
        relatedIds,
        data: { issueKey, status, reason, sourceCommand: SOURCE_COMMAND },
      }),
    );

    return makeResult({
      status: "passed",
      action: "issue",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Updated issue ${issueKey} to ${status}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Stored issue override",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: relatedIds,
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: { issueKey, status, reason, changed: true, nextRecommendedCommand },
    });
  } catch (err) {
    return errorToResult("issue", err);
  }
}
