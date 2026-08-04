import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord, saveAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { isValidRunStatusTransition } from "../../workflow/autonomous-run-lifecycle.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";
import type { AutonomousRunAuditEntry } from "../../schema/autonomous-run-record.schema.js";

/**
 * M37-WU01 (build spec: "aiqt autonomous cancel"; acceptance criterion:
 * "Allow only cancellable states and create an audit event"). A run may
 * be cancelled from any non-terminal status -- the M36-WU01 lifecycle
 * table already permits "cancelled" as a direct target from every
 * non-terminal row, so this command trusts that table rather than
 * maintaining its own separate allow-list.
 */
export interface AutonomousCancelOptions {
  run?: string;
  reason?: string;
  configPath?: string;
  evidenceDir?: string;
}

export function runAutonomousCancel(ctx: CommandContext, options: AutonomousCancelOptions): CommandResult {
  if (!options.run || options.run.trim() === "") {
    return autonomousFailure("aiqt autonomous cancel requires --run <runId>.", ExitCode.InvalidInput, "AUTONOMOUS-CANCEL-NO-RUN");
  }
  if (!options.reason || options.reason.trim() === "") {
    return autonomousFailure("aiqt autonomous cancel requires --reason <text>.", ExitCode.InvalidInput, "AUTONOMOUS-CANCEL-NO-REASON");
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
    return autonomousFailure(loaded.reason, ExitCode.InvalidInput, "AUTONOMOUS-CANCEL-RUN-NOT-FOUND");
  }
  const record = loaded.record;

  if (!isValidRunStatusTransition(record.status, "cancelled")) {
    return autonomousFailure(`Run ${record.runId} is in status "${record.status}" and cannot be cancelled (it is already terminal).`, ExitCode.WorkflowBlocked, "AUTONOMOUS-CANCEL-NOT-CANCELLABLE");
  }

  const nowIso = new Date().toISOString();
  const auditEntry: AutonomousRunAuditEntry = { event: "autonomous_run.cancelled", at: nowIso, detail: options.reason };
  const updated = {
    ...record,
    status: "cancelled" as const,
    updatedAt: nowIso,
    auditLog: [...record.auditLog, auditEntry],
  };
  saveAutonomousRunRecord(updated, config.evidenceOutputDir);

  return makeResult({
    status: "passed",
    action: "autonomous",
    summary: `Run ${record.runId} cancelled: ${options.reason}`,
    exitCode: ExitCode.Success,
    data: { runId: record.runId, status: updated.status },
  });
}
