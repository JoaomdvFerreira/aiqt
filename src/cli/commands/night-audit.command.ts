import type { CommandContext } from "../command-context.js";
import { makeResult, familyFailureResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { readBoundedTextFile } from "../../core/filesystem/bounded-file-input.js";
import { MAX_SUBMITTED_FINDINGS_PER_TASK, ReviewTaskSubmissionSchema, type ReviewTask } from "../../schema/night-audit.schema.js";
import {
  resolveNightAuditTargetRoot,
  runNightAuditStep,
  submitReviewTaskFindings,
  cancelNightAuditSession,
  getNightAuditStatus,
  getNightAuditCoverage,
} from "../../services/night-audit-session-service.js";
import { computeReviewTaskId } from "../../workflow/night-audit-coverage-queue.js";

/**
 * M48-WU05 (build spec Sec 4/16): `aiqt review night run|submit|status|
 * cancel|coverage`. Nested under the existing `review` command family
 * exactly as `review structural` already is -- not a new top-level
 * command. Never modifies project source; the only external mutation
 * (GitHub Issue creation) happens inside `submit`, behind the exact
 * lookup-before-create discipline in
 * night-audit-issue-publication-service.ts.
 */

const MAX_ISSUE_BODY_BYTES = 262144;

function nightAuditFailure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "review", area: "night-audit", summary, exitCode, issueId });
}

function resolveTargetOrFailure(ctx: CommandContext, options: { repository?: string; portfolio?: string; member?: string }): { ok: true; root: string; portfolioRef: { portfolioId: string; memberId: string } | null } | { ok: false; result: CommandResult } {
  if ((options.portfolio && !options.member) || (!options.portfolio && options.member)) {
    return { ok: false, result: nightAuditFailure("--portfolio and --member must be used together.", ExitCode.InvalidInput, "NIGHT-AUDIT-PORTFOLIO-MEMBER-INCOMPLETE") };
  }
  const portfolio = options.portfolio && options.member ? { portfolioId: options.portfolio, memberId: options.member } : undefined;
  const resolved = resolveNightAuditTargetRoot(ctx.cwd, options.repository, portfolio);
  if (!resolved.ok) {
    return { ok: false, result: nightAuditFailure(resolved.reason, ExitCode.InvalidInput, "NIGHT-AUDIT-TARGET-UNRESOLVED") };
  }
  return { ok: true, root: resolved.root, portfolioRef: resolved.portfolioRef };
}

export interface RunReviewNightRunOptions {
  repository?: string;
  portfolio?: string;
  member?: string;
  targetDurationMinutes?: number;
  hardStopMinutes?: number;
  maxReviewTasks?: number;
  maxNewIssues?: number;
  maxOpenAuditIssueBacklog?: number;
}

const DEFAULT_BUDGET = {
  targetDurationMinutes: 120,
  hardStopMinutes: 180,
  maxReviewTasks: 40,
  maxNewIssues: 10,
  maxOpenAuditIssueBacklog: 25,
};

export function runReviewNightRun(ctx: CommandContext, options: RunReviewNightRunOptions): CommandResult {
  const target = resolveTargetOrFailure(ctx, options);
  if (!target.ok) return target.result;

  try {
    const outcome = runNightAuditStep({
      root: target.root,
      portfolioRef: target.portfolioRef,
      budget: {
        targetDurationMinutes: options.targetDurationMinutes ?? DEFAULT_BUDGET.targetDurationMinutes,
        hardStopMinutes: options.hardStopMinutes ?? DEFAULT_BUDGET.hardStopMinutes,
        maxReviewTasks: options.maxReviewTasks ?? DEFAULT_BUDGET.maxReviewTasks,
        maxNewIssues: options.maxNewIssues ?? DEFAULT_BUDGET.maxNewIssues,
        maxOpenAuditIssueBacklog: options.maxOpenAuditIssueBacklog ?? DEFAULT_BUDGET.maxOpenAuditIssueBacklog,
      },
    });

    if (outcome.kind === "lock_held") {
      return nightAuditFailure("Another Night Audit operation is already in progress for this project.", ExitCode.WorkflowBlocked, "NIGHT-AUDIT-LOCK-HELD");
    }

    if (outcome.kind === "stopped") {
      return makeResult({
        status: "passed",
        action: "review",
        summary: `Night Audit session ${outcome.result.sessionId} finished: ${outcome.result.stopReason}. ${outcome.result.tasksCompleted} task(s) completed.`,
        exitCode: ExitCode.Success,
        completedActions: ["Session finalized"],
        affectedItems: [outcome.result.sessionId],
        data: { outcome: "stopped", result: outcome.result },
      });
    }

    return makeResult({
      status: "passed",
      action: "review",
      summary: `Night Audit session ${outcome.sessionId}: next ReviewTask ${outcome.task.taskId} (domain "${outcome.task.domain}", scope "${outcome.task.scope}"). Report findings with "aiqt review night submit".`,
      exitCode: ExitCode.Success,
      affectedItems: [outcome.sessionId, outcome.task.taskId],
      nextRecommendedCommand: `aiqt review night submit ${outcome.task.taskId} --domain ${outcome.task.domain} --scope "${outcome.task.scope}" --commit ${outcome.task.repositoryCommit} --from-file <path>`,
      data: { outcome: "task", sessionId: outcome.sessionId, task: outcome.task, packet: outcome.packet, structuralCandidates: outcome.structuralCandidates },
    });
  } catch (err) {
    return nightAuditFailure((err as Error).message, ExitCode.InvalidInput, "NIGHT-AUDIT-RUN-ERROR");
  }
}

export interface RunReviewNightSubmitOptions {
  repository?: string;
  portfolio?: string;
  member?: string;
  domain?: string;
  scope?: string;
  commit?: string;
  fromFile?: string;
  tokenEnv?: string;
}

export async function runReviewNightSubmit(ctx: CommandContext, taskId: string, options: RunReviewNightSubmitOptions, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  const target = resolveTargetOrFailure(ctx, options);
  if (!target.ok) return target.result;

  if (!options.domain || !options.scope || !options.commit) {
    return nightAuditFailure("--domain, --scope, and --commit are required (the exact fields the ReviewTask was issued with).", ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-MISSING-TASK-FIELDS");
  }
  const expectedTaskId = computeReviewTaskId(options.domain as never, options.scope, options.commit);
  if (expectedTaskId !== taskId) {
    return nightAuditFailure(`Task id "${taskId}" does not match the id derived from --domain/--scope/--commit ("${expectedTaskId}"). Submit against the exact task returned by "aiqt review night run".`, ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-TASK-ID-MISMATCH");
  }
  const task: ReviewTask = { taskId, domain: options.domain as ReviewTask["domain"], scope: options.scope, repositoryCommit: options.commit };

  if (!options.fromFile) {
    return nightAuditFailure("--from-file is required: a bounded JSON file with { taskId, findings: [...] } (never an unbounded CLI argument).", ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-NO-INPUT");
  }
  const read = readBoundedTextFile(options.fromFile, MAX_ISSUE_BODY_BYTES);
  if (!read.ok) {
    return nightAuditFailure(read.error, ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-FILE-READ-ERROR");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(read.text);
  } catch (err) {
    return nightAuditFailure(`--from-file did not contain valid JSON: ${(err as Error).message}`, ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-INVALID-JSON");
  }
  const submissionResult = ReviewTaskSubmissionSchema.safeParse(parsedJson);
  if (!submissionResult.success) {
    return nightAuditFailure(`--from-file did not match the expected submission shape: ${submissionResult.error.issues.map((i) => i.message).join("; ")}`, ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-SCHEMA-INVALID");
  }
  if (submissionResult.data.taskId !== taskId) {
    return nightAuditFailure(`--from-file's taskId ("${submissionResult.data.taskId}") does not match the submitted task ("${taskId}").`, ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-FILE-TASK-ID-MISMATCH");
  }
  if (submissionResult.data.findings.length > MAX_SUBMITTED_FINDINGS_PER_TASK) {
    return nightAuditFailure(`--from-file carries more than ${MAX_SUBMITTED_FINDINGS_PER_TASK} findings for one task.`, ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-TOO-MANY-FINDINGS");
  }

  const tokenEnvName = options.tokenEnv ?? "GITHUB_TOKEN";
  const token = env[tokenEnvName];

  try {
    const outcome = await submitReviewTaskFindings({
      root: target.root,
      task,
      submission: submissionResult.data,
      githubToken: token && token.length > 0 ? token : null,
    });

    return makeResult({
      status: "passed",
      action: "review",
      summary: `Task ${outcome.taskId}: ${outcome.acceptedCount} accepted, ${outcome.rejectedCount} rejected out of ${submissionResult.data.findings.length} submitted finding(s).`,
      exitCode: ExitCode.Success,
      completedActions: ["Quality-gated and deduplicated findings", "Updated the coverage ledger"],
      affectedItems: [outcome.sessionId, outcome.taskId],
      nextRecommendedCommand: "aiqt review night run",
      data: { outcome },
    });
  } catch (err) {
    return nightAuditFailure((err as Error).message, ExitCode.InvalidInput, "NIGHT-AUDIT-SUBMIT-ERROR");
  }
}

export interface NightAuditTargetOptions {
  repository?: string;
  portfolio?: string;
  member?: string;
}

export function runReviewNightStatus(ctx: CommandContext, options: NightAuditTargetOptions): CommandResult {
  const target = resolveTargetOrFailure(ctx, options);
  if (!target.ok) return target.result;
  try {
    const status = getNightAuditStatus(target.root);
    const summary =
      status.kind === "active"
        ? `Night Audit session ${status.active.sessionId} is active (${status.active.usage.reviewTasksCompleted} task(s) completed so far).`
        : status.kind === "last_result"
          ? `Most recent Night Audit session ${status.result.sessionId} finished: ${status.result.stopReason}.`
          : "No Night Audit session has ever run for this project.";
    return makeResult({ status: "passed", action: "review", summary, exitCode: ExitCode.Success, data: { status } });
  } catch (err) {
    return nightAuditFailure((err as Error).message, ExitCode.InvalidInput, "NIGHT-AUDIT-STATUS-ERROR");
  }
}

export function runReviewNightCancel(ctx: CommandContext, options: NightAuditTargetOptions): CommandResult {
  const target = resolveTargetOrFailure(ctx, options);
  if (!target.ok) return target.result;
  const outcome = cancelNightAuditSession(target.root);
  if (!outcome.ok) {
    return nightAuditFailure(outcome.reason, ExitCode.WorkflowBlocked, "NIGHT-AUDIT-CANCEL-FAILED");
  }
  return makeResult({
    status: "passed",
    action: "review",
    summary: `Cancelled Night Audit session ${outcome.sessionId}.`,
    exitCode: ExitCode.Success,
    completedActions: ["Cleared the active session"],
    affectedItems: [outcome.sessionId],
    data: { result: outcome.result },
  });
}

export function runReviewNightCoverage(ctx: CommandContext, options: NightAuditTargetOptions): CommandResult {
  const target = resolveTargetOrFailure(ctx, options);
  if (!target.ok) return target.result;
  try {
    const coverage = getNightAuditCoverage(target.root);
    return makeResult({
      status: "passed",
      action: "review",
      summary: `${coverage.length} coverage ledger entr${coverage.length === 1 ? "y" : "ies"}.`,
      exitCode: ExitCode.Success,
      data: { coverage },
    });
  } catch (err) {
    return nightAuditFailure((err as Error).message, ExitCode.InvalidInput, "NIGHT-AUDIT-COVERAGE-ERROR");
  }
}
