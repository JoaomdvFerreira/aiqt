import type { Issue } from "./issue.js";
import type { ProjectStatus } from "../../schema/state.schema.js";
import { AiqtError } from "./aiqt-error.js";
import { ExitCode } from "./exit-codes.js";

export type CommandStatus =
  | "passed"
  | "failed"
  | "blocked"
  | "warning"
  | "needs_input";

export type WorkflowAction =
  | "init"
  | "update"
  | "plan"
  | "next"
  | "checkpoint"
  | "review"
  | "export"
  | "status";

export interface CommandResult<TData = unknown> {
  status: CommandStatus;
  action: WorkflowAction;
  projectStatus: ProjectStatus | null;
  currentMilestoneId: string | null;
  currentWorkUnitId: string | null;
  summary: string;
  completedActions: string[];
  changedFiles: string[];
  affectedItems: string[];
  blockingIssues: Issue[];
  warnings: Issue[];
  requiresHumanInput: boolean;
  nextRecommendedCommand: string | null;
  data?: TData;
  exitCode: number;
}

/**
 * Build a CommandResult with sensible empty defaults so callers only specify
 * the fields that vary. Keeps JSON output shape stable and deterministic.
 */
export function makeResult<TData = unknown>(
  partial: Partial<CommandResult<TData>> &
    Pick<CommandResult<TData>, "status" | "action" | "summary" | "exitCode">,
): CommandResult<TData> {
  // Construct in canonical CommandResult key order so JSON output is both
  // deterministic and matches the documented contract field ordering.
  const result: CommandResult<TData> = {
    status: partial.status,
    action: partial.action,
    projectStatus: partial.projectStatus ?? null,
    currentMilestoneId: partial.currentMilestoneId ?? null,
    currentWorkUnitId: partial.currentWorkUnitId ?? null,
    summary: partial.summary,
    completedActions: partial.completedActions ?? [],
    changedFiles: partial.changedFiles ?? [],
    affectedItems: partial.affectedItems ?? [],
    blockingIssues: partial.blockingIssues ?? [],
    warnings: partial.warnings ?? [],
    requiresHumanInput: partial.requiresHumanInput ?? false,
    nextRecommendedCommand: partial.nextRecommendedCommand ?? null,
    exitCode: partial.exitCode,
  };
  if (partial.data !== undefined) {
    result.data = partial.data;
  }
  return result;
}

/**
 * Convert a thrown error into a failed/blocked CommandResult. AiqtError carries
 * an exit code and optional Issue; any other error becomes a generic invalid
 * input failure with exit code 3.
 */
export function errorToResult(
  action: WorkflowAction,
  err: unknown,
): CommandResult {
  if (err instanceof AiqtError) {
    const status: CommandStatus =
      err.exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed";
    return makeResult({
      status,
      action,
      summary: err.message,
      exitCode: err.exitCode,
      blockingIssues: err.issue ? [err.issue] : [],
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return makeResult({
    status: "failed",
    action,
    summary: message,
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [
      {
        id: "UNEXPECTED-ERROR",
        severity: "critical",
        area: "cli",
        message,
        agentCanFix: false,
      },
    ],
  });
}
