import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord, deleteAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { isTerminalRunStatus } from "../../schema/autonomous-run.schema.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";

/**
 * M37-WU01/WU03 (build spec: "aiqt autonomous cleanup"; acceptance
 * criterion: "Simulation-safe cleanup only; no deletion outside approved
 * run paths"). The cleanup surface here is deleting exactly one run
 * record's own JSON file, strictly within the resolved evidenceOutputDir
 * (deleteAutonomousRunRecord's own runId-shape validation makes any path
 * outside that directory structurally unreachable). Only a terminal run
 * may be cleaned up -- an active run must be cancelled first.
 *
 * A real (non-simulated) run's own worktree is always created AND
 * removed within the single, synchronous `aiqt autonomous agent-import`
 * call that produces it (M36-WU04's produceAutonomousEvidencePacket
 * guarantees cleanup is attempted exactly once, in a `finally` block, by
 * the time that command returns) -- there is never a real worktree still
 * open by the time a run reaches a terminal status, so this command
 * itself never touches one. The one exception: if that cleanup attempt
 * itself failed (`evidencePacket.workspace.cleanupStatus ===
 * "cleanup_failed"`), this command refuses to delete the run record --
 * doing so would destroy the only recorded reference to the orphaned
 * worktree path, making the operator's own manual cleanup harder, not
 * easier.
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

  if (record.evidencePacket?.workspace?.cleanupStatus === "cleanup_failed") {
    return autonomousFailure(
      `Run ${record.runId}'s own worktree cleanup previously failed (path: ${record.evidencePacket.workspace.worktreePath}). Remove it manually (git worktree remove, possibly with --force) before cleaning up this run's record -- deleting the record now would lose the only reference to it.`,
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-CLEANUP-ORPHANED-WORKTREE",
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
