import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord, listAutonomousRunIds } from "../../services/autonomous-run-store.js";
import { isTerminalRunStatus } from "../../schema/autonomous-run.schema.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";

/**
 * M37-WU01 (build spec: "aiqt autonomous status"; acceptance criterion:
 * "classification, budgets, permissions, and approval visible"). Purely
 * read-only -- lists every persisted run id when --run is omitted, or
 * reports one run's full lifecycle/candidate/classification/budgets/
 * approval/evidence-availability summary when given.
 */
export interface AutonomousStatusOptions {
  run?: string;
  configPath?: string;
  evidenceDir?: string;
}

export function runAutonomousStatus(ctx: CommandContext, options: AutonomousStatusOptions): CommandResult {
  const configOutcome = resolveOperatorConfigOrFail({
    cwd: ctx.cwd,
    configPath: options.configPath,
    cliFlags: options.evidenceDir ? { evidenceOutputDir: options.evidenceDir } : {},
  });
  if (!configOutcome.ok) return configOutcome.result;
  const config = configOutcome.config;

  if (!options.run) {
    const runIds = listAutonomousRunIds(config.evidenceOutputDir);
    return makeResult({
      status: "passed",
      action: "autonomous",
      summary: runIds.length === 0 ? "No autonomous runs recorded." : `${runIds.length} autonomous run(s) recorded.`,
      exitCode: ExitCode.Success,
      data: { evidenceOutputDir: config.evidenceOutputDir, runIds },
    });
  }

  const loaded = loadAutonomousRunRecord(options.run, config.evidenceOutputDir);
  if (!loaded.ok) {
    return autonomousFailure(loaded.reason, ExitCode.InvalidInput, "AUTONOMOUS-STATUS-RUN-NOT-FOUND");
  }
  const record = loaded.record;

  return makeResult({
    status: "passed",
    action: "autonomous",
    summary: `Run ${record.runId} is in status "${record.status}".`,
    exitCode: ExitCode.Success,
    data: {
      runId: record.runId,
      status: record.status,
      terminal: isTerminalRunStatus(record.status),
      repositoryPath: record.repositoryPath,
      baseCommit: record.baseCommit,
      candidate: record.candidate,
      safetyAssessment: record.safetyAssessment,
      budgets: record.budgets,
      policy: record.policy,
      approval: record.approval,
      evidenceAvailable: record.evidencePacket !== null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  });
}
