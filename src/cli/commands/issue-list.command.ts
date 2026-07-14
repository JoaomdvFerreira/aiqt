import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";
import { runReview } from "../../services/review-service.js";
import { buildNormalizedIssues, type NormalizedIssue } from "../../services/issue-service.js";
import type { IssueOverrideStatus } from "../../schema/issue-state.schema.js";

export interface IssueListEntry {
  issueKey: string;
  source: NormalizedIssue["source"];
  workUnitId: string | null;
  status: IssueOverrideStatus;
  classification: NormalizedIssue["classification"];
  message: string;
  promotedWorkUnitId: string | null;
}

export interface IssueListCounts {
  active: number;
  accepted: number;
  deferred: number;
  resolved: number;
  post_mvp: number;
  promoted: number;
}

export interface IssueListData {
  issues: IssueListEntry[];
  counts: IssueListCounts;
}

function buildCounts(issues: readonly NormalizedIssue[]): IssueListCounts {
  const counts: IssueListCounts = {
    active: 0,
    accepted: 0,
    deferred: 0,
    resolved: 0,
    post_mvp: 0,
    promoted: 0,
  };
  for (const issue of issues) {
    counts[issue.status] += 1;
    if (issue.promotedWorkUnitId !== null) counts.promoted += 1;
  }
  return counts;
}

/** aiqt issue list (M11 §14.1): read-only, deterministic normalized issue view. */
export function runIssueList(ctx: CommandContext): CommandResult {
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
            id: "ISSUE-LIST-NO-PROJECT",
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
    const counts = buildCounts(issues);

    return makeResult({
      status: "passed",
      action: "issue",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `${issues.length} issue(s) found.`,
      exitCode: ExitCode.Success,
      data: {
        issues: issues.map((i) => ({
          issueKey: i.issueKey,
          source: i.source,
          workUnitId: i.workUnitId,
          status: i.status,
          classification: i.classification,
          message: i.message,
          promotedWorkUnitId: i.promotedWorkUnitId,
        })),
        counts,
      },
    });
  } catch (err) {
    return errorToResult("issue", err);
  }
}
