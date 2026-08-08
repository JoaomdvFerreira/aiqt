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
  | "status"
  | "start"
  | "continue"
  | "prompt"
  | "import"
  | "manage"
  | "skills"
  | "issue"
  | "repair"
  | "dependency"
  | "graph"
  | "evidence"
  | "workspace"
  | "execution"
  | "autonomous"
  | "release"
  | "validation";

export interface CommandResult<TData = unknown> {
  status: CommandStatus;
  // M33 Sec 5.1: widened from WorkflowAction to WorkflowAction | string so
  // parserErrorToResult() can report "cli" for a failure that occurred
  // before any specific command's action was ever identified (a parser-
  // level error, by definition, means dispatch to a command never
  // happened). Every other caller continues to pass a real WorkflowAction.
  action: WorkflowAction | string;
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
 * M33-WU02: the single authoritative convergence point for every command
 * family's local `failure(summary, exitCode, issueId)` helper (see
 * docs/engineering/m33-wu01-command-result-contract.md Sec 1.2/3.B for the
 * pre-migration inventory). Centralizing status derivation here enforces the
 * M33 Sec 5.2 exit-10 invariant (`exitCode === 10 <=> status ===
 * "needs_input" && requiresHumanInput === true`) for every call site that
 * routes through it, without requiring each of the ~29 call sites to be
 * individually rewritten.
 *
 * Also enforces the M33 Sec 5.10 missing-project contract: any issueId
 * matching the repository's existing `<CMD>-NO-PROJECT` / `AIQT-DIR-MISSING`
 * convention automatically receives the actionable `nextRecommendedCommand:
 * "aiqt init"` recommendation, closing the gap where local failure()
 * helpers previously never set it (M33-WU01 Contradiction E).
 */
export function familyFailureResult(params: {
  action: WorkflowAction;
  area: string;
  summary: string;
  exitCode: number;
  issueId: string;
  extraIssueFields?: Partial<Issue>;
  projectStatus?: ProjectStatus | null;
  currentMilestoneId?: string | null;
  currentWorkUnitId?: string | null;
}): CommandResult {
  const status: CommandStatus =
    params.exitCode === ExitCode.WorkflowBlocked
      ? "blocked"
      : params.exitCode === ExitCode.HumanInputRequired
        ? "needs_input"
        : "failed";
  const isMissingProject = /NO-PROJECT|DIR-MISSING/.test(params.issueId);
  return makeResult({
    status,
    action: params.action,
    projectStatus: params.projectStatus ?? null,
    currentMilestoneId: params.currentMilestoneId ?? null,
    currentWorkUnitId: params.currentWorkUnitId ?? null,
    summary: params.summary,
    exitCode: params.exitCode,
    requiresHumanInput: status === "needs_input",
    nextRecommendedCommand: isMissingProject ? "aiqt init" : null,
    blockingIssues: [
      {
        id: params.issueId,
        severity: "high",
        area: params.area,
        message: params.summary,
        agentCanFix: false,
        ...params.extraIssueFields,
      },
    ],
  });
}

/**
 * M33-WU02 Sec 5.10: the shared missing-project result for commands using
 * the repository's existing bespoke pre-check pattern (`if
 * (!aiqtDirExists(ctx)) return ...`), as used by review/next/manage/export.
 * Consistent issue-id shape (`<CMD>-NO-PROJECT`), severity, area, exit code,
 * and actionable `nextRecommendedCommand` across every command that adopts
 * it -- closing M33-WU01 Contradiction E.
 */
export function missingProjectResult(
  action: WorkflowAction,
  issueIdPrefix: string,
): CommandResult {
  return makeResult({
    status: "failed",
    action,
    summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
    nextRecommendedCommand: "aiqt init",
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [
      {
        id: `${issueIdPrefix}-NO-PROJECT`,
        severity: "high",
        area: "workflow",
        message: ".aiqt/ not found in the current folder.",
        suggestedAction: "Run aiqt init.",
        agentCanFix: false,
      },
    ],
  });
}

/**
 * M33-WU03 Sec 5.4 (JSON guarantee): converts a commander parser-level error
 * (unknown command, unknown option, missing required argument, and similar
 * CommanderError instances raised before a command action ever runs) into a
 * canonical CommandResult, so `--json` produces valid, parseable JSON for
 * these failures instead of commander's own raw error text (M33-WU01
 * Contradiction A). `action` is "cli" (not a WorkflowAction) since the
 * command that would have owned an action-specific value was never
 * identified -- the parser failed before dispatch.
 */
export function parserErrorToResult(err: {
  code?: string;
  message?: string;
  exitCode?: number;
}): CommandResult {
  const message = err.message ?? "Invalid command line input.";
  const issueIdByCode: Record<string, string> = {
    "commander.unknownCommand": "CLI-UNKNOWN-COMMAND",
    "commander.unknownOption": "CLI-UNKNOWN-OPTION",
    "commander.missingArgument": "CLI-MISSING-ARGUMENT",
    "commander.missingMandatoryOptionValue": "CLI-MISSING-OPTION-VALUE",
    "commander.optionMissingArgument": "CLI-OPTION-MISSING-ARGUMENT",
    "commander.invalidArgument": "CLI-INVALID-ARGUMENT",
    "commander.excessArguments": "CLI-EXCESS-ARGUMENTS",
    "commander.conflictingOption": "CLI-CONFLICTING-OPTION",
  };
  const issueId = issueIdByCode[err.code ?? ""] ?? "CLI-PARSE-ERROR";
  return makeResult({
    status: "failed",
    action: "cli",
    summary: message,
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [
      {
        id: issueId,
        severity: "high",
        area: "cli",
        message,
        agentCanFix: false,
      },
    ],
  });
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
