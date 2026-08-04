import { confirm } from "@inquirer/prompts";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord, saveAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { isValidRunStatusTransition } from "../../workflow/autonomous-run-lifecycle.js";
import { computeApprovalBindingDigest } from "../../workflow/autonomous-run-approval.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";
import { isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import type { AutonomousRunAuditEntry } from "../../schema/autonomous-run-record.schema.js";

/**
 * M37-WU01 (build spec Sec 6.3 "Approval"). Approves exactly one run
 * currently in `awaiting_approval`. Interactive mode (a real TTY, no
 * `--yes`) prompts via @inquirer/prompts' `confirm` (the same library
 * already used for `aiqt update`'s interactive flow); non-interactive
 * mode requires the explicit `--yes` flag -- there is no silent default
 * approval either way. The approval is bound (sha256 digest) to the
 * exact candidate/base-commit/budgets at approval time; a later `run`
 * against a record whose candidate/budgets changed since is rejected as
 * stale (autonomous-run-approval.ts).
 */
export interface AutonomousApproveOptions {
  run?: string;
  yes?: boolean;
  configPath?: string;
  evidenceDir?: string;
}

interface Deps {
  stdin?: StdinLike;
  confirmFn?: typeof confirm;
}

export async function runAutonomousApprove(ctx: CommandContext, options: AutonomousApproveOptions, deps: Deps = {}): Promise<CommandResult> {
  if (!options.run || options.run.trim() === "") {
    return autonomousFailure("aiqt autonomous approve requires --run <runId>.", ExitCode.InvalidInput, "AUTONOMOUS-APPROVE-NO-RUN");
  }

  const configOutcome = resolveOperatorConfigOrFail({
    cwd: ctx.cwd,
    configPath: options.configPath,
    cliFlags: options.evidenceDir ? { evidenceOutputDir: options.evidenceDir } : {},
  });
  if (!configOutcome.ok) return configOutcome.result;
  const config = configOutcome.config;

  const loaded = loadAutonomousRunRecord(options.run, config.evidenceOutputDir);
  if (!loaded.ok) {
    return autonomousFailure(loaded.reason, ExitCode.InvalidInput, "AUTONOMOUS-APPROVE-RUN-NOT-FOUND");
  }
  const record = loaded.record;

  if (record.status !== "awaiting_approval") {
    return autonomousFailure(
      `Run ${record.runId} is in status "${record.status}" and is not awaiting approval (only a run in "awaiting_approval" may be approved).`,
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-APPROVE-WRONG-STATUS",
    );
  }
  if (!isValidRunStatusTransition(record.status, "preparing_workspace")) {
    return autonomousFailure(`Run ${record.runId} cannot transition from "${record.status}" to an approved state.`, ExitCode.WorkflowBlocked, "AUTONOMOUS-APPROVE-INVALID-TRANSITION");
  }
  if (!record.baseCommit) {
    return autonomousFailure(`Run ${record.runId} has no resolved base commit and cannot be approved.`, ExitCode.WorkflowBlocked, "AUTONOMOUS-APPROVE-NO-BASE-COMMIT");
  }

  let approvedBy: "interactive" | "--yes";
  if (options.yes) {
    approvedBy = "--yes";
  } else if (isStdinInteractiveTty(deps.stdin)) {
    const doConfirm = deps.confirmFn ?? confirm;
    const approved = await doConfirm({
      message: `Approve run ${record.runId} (issue "${record.candidate.issueId}", risk "${record.safetyAssessment.riskClass}")?`,
      default: false,
    });
    if (!approved) {
      return autonomousFailure(`Run ${record.runId} was not approved (operator declined the interactive confirmation).`, ExitCode.WorkflowBlocked, "AUTONOMOUS-APPROVE-DECLINED");
    }
    approvedBy = "interactive";
  } else {
    return autonomousFailure(
      "aiqt autonomous approve requires --yes when not running in an interactive terminal.",
      ExitCode.InvalidInput,
      "AUTONOMOUS-APPROVE-NON-INTERACTIVE-NO-YES",
    );
  }

  const bindingDigest = computeApprovalBindingDigest({ candidate: record.candidate, baseCommit: record.baseCommit, budgets: record.budgets });
  const nowIso = new Date().toISOString();
  const auditEntry: AutonomousRunAuditEntry = { event: "autonomous_run.approval_granted", at: nowIso, detail: `Approved by ${approvedBy}.` };

  const updated = {
    ...record,
    status: "preparing_workspace" as const,
    updatedAt: nowIso,
    approval: { approvedAt: nowIso, approvedBy, bindingDigest },
    auditLog: [...record.auditLog, auditEntry],
  };
  saveAutonomousRunRecord(updated, config.evidenceOutputDir);

  return makeResult({
    status: "passed",
    action: "autonomous",
    summary: `Run ${record.runId} approved by ${approvedBy}. Ready for aiqt autonomous run.`,
    exitCode: ExitCode.Success,
    nextRecommendedCommand: "aiqt autonomous run",
    data: { runId: record.runId, status: updated.status, approval: updated.approval },
  });
}
