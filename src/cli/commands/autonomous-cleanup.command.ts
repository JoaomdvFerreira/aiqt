import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord, deleteAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { isTerminalRunStatus } from "../../schema/autonomous-run.schema.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";

/**
 * M37-WU01 (build spec: "aiqt autonomous cleanup"; acceptance criterion:
 * "Simulation-safe cleanup only; no deletion outside approved run
 * paths"). No real worktree exists anywhere in this Work Unit's pipeline
 * (autonomous-run-store.ts never created one), so the entire cleanup
 * surface here is deleting exactly one run record's own JSON file,
 * strictly within the resolved evidenceOutputDir
 * (deleteAutonomousRunRecord's own runId-shape validation makes any path
 * outside that directory structurally unreachable). Only a terminal run
 * may be cleaned up -- an active run must be cancelled first.
 */
export interface AutonomousCleanupOptions {
  run?: string;
  configPath?: string;
  evidenceDir?: string;
}

export function runAutonomousCleanup(ctx: CommandContext, options: AutonomousCleanupOptions): CommandResult {
  if (!options.run || options.run.trim() === "") {
    return autonomousFailure("aiqt autonomous cleanup requires --run <runId>.", ExitCode.InvalidInput, "AUTONOMOUS-CLEANUP-NO-RUN");
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
    return autonomousFailure(loaded.reason, ExitCode.InvalidInput, "AUTONOMOUS-CLEANUP-RUN-NOT-FOUND");
  }
  const record = loaded.record;

  if (!isTerminalRunStatus(record.status)) {
    return autonomousFailure(
      `Run ${record.runId} is in status "${record.status}", which is not terminal. Cancel it (aiqt autonomous cancel) before cleaning up.`,
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-CLEANUP-NOT-TERMINAL",
    );
  }

  const deleted = deleteAutonomousRunRecord(record.runId, config.evidenceOutputDir);
  if (!deleted.ok) {
    return autonomousFailure(deleted.reason, ExitCode.InvalidInput, "AUTONOMOUS-CLEANUP-DELETE-FAILED");
  }

  return makeResult({
    status: "passed",
    action: "autonomous",
    summary: `Run ${record.runId} record cleaned up.`,
    exitCode: ExitCode.Success,
    data: { runId: record.runId },
  });
}
