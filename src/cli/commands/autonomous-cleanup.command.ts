import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord, deleteAutonomousRunRecord, saveAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { isTerminalRunStatus } from "../../schema/autonomous-run.schema.js";
import { DockerSandboxBackend } from "../../workspaces/sandbox-docker-backend.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";

/**
 * M37-WU01/WU03/M38-WU04 (build spec: "aiqt autonomous cleanup";
 * acceptance criterion: "Simulation-safe cleanup only; no deletion
 * outside approved run paths"; M38: "crash recovery"). The cleanup
 * surface here is deleting exactly one run record's own JSON file,
 * strictly within the resolved evidenceOutputDir (deleteAutonomousRunRecord's
 * own runId-shape validation makes any path outside that directory
 * structurally unreachable). Only a terminal run may be cleaned up --
 * an active run must be cancelled first.
 *
 * A real (non-simulated, non-live) run's own worktree is always
 * created AND removed within the single, synchronous `aiqt autonomous
 * agent-import` call that produces it (M36-WU04's
 * produceAutonomousEvidencePacket guarantees cleanup is attempted
 * exactly once, in a `finally` block, by the time that command
 * returns) -- there is never a real worktree still open by the time a
 * run reaches a terminal status, so this command itself never touches
 * one. The one exception: if that cleanup attempt itself failed
 * (`evidencePacket.workspace.cleanupStatus === "cleanup_failed"`),
 * this command refuses to delete the run record -- doing so would
 * destroy the only recorded reference to the orphaned worktree path,
 * making the operator's own manual cleanup harder, not easier.
 *
 * M38-WU04 crash recovery: a `--live` run persists its real sandbox
 * container id (`sandboxContainerId`) to the run record IMMEDIATELY
 * after creating it -- before running any command inside it -- so that
 * id survives even if AIQT itself crashes mid-run, before its own
 * `agent-import` call ever reaches its own `cleanup()`. This command
 * is the recovery point: if a run's container was never confirmed
 * cleaned (`sandboxEvidence` is null, or its `cleanupStatus` is
 * `"cleanup_failed"`), this command attempts a REAL `destroy()` of
 * that container (a fresh Docker connection, quite possibly a fresh
 * process entirely) before deciding whether the record may be
 * deleted -- closing exactly the gap a mid-run crash would otherwise
 * leave open. If the sandbox backend is unavailable (e.g. Docker is
 * not running right now), cleanup refuses, preserving the only
 * reference to the possibly-still-orphaned container -- the same
 * "never destroy the only reference" discipline as the pre-existing
 * worktree case above.
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
  let record = loaded.record;

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

  const sandboxCleanupUnconfirmed = record.sandboxContainerId !== null && record.sandboxEvidence?.cleanupStatus !== "cleaned";
  if (sandboxCleanupUnconfirmed) {
    const backend = new DockerSandboxBackend();
    const availability = backend.checkAvailability();
    if (!availability.available) {
      return autonomousFailure(
        `Run ${record.runId} has an unconfirmed sandbox container (id: ${record.sandboxContainerId}) and the sandbox backend is currently unavailable (${availability.reason}). Refusing to delete the run record -- it is the only reference to that container. Retry once Docker is available.`,
        ExitCode.WorkflowBlocked,
        "AUTONOMOUS-CLEANUP-SANDBOX-BACKEND-UNAVAILABLE",
      );
    }
    const destroyResult = backend.destroy({ sandboxId: record.sandboxContainerId! });
    if (!destroyResult.ok) {
      return autonomousFailure(
        `Run ${record.runId}'s sandbox container (id: ${record.sandboxContainerId}) could not be confirmed destroyed: ${destroyResult.reason}. Remove it manually (docker rm -f ${record.sandboxContainerId}) before cleaning up this run's record.`,
        ExitCode.WorkflowBlocked,
        "AUTONOMOUS-CLEANUP-ORPHANED-SANDBOX",
      );
    }
    // Real crash recovery succeeded: the container is now confirmed gone.
    // Persist that before proceeding, so a retry of this same command
    // (or a status check) never re-attempts destroying an
    // already-destroyed container.
    record = { ...record, updatedAt: new Date().toISOString(), sandboxContainerId: null };
    saveAutonomousRunRecord(record, config.evidenceOutputDir);
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
