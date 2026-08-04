import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { buildAutonomousRunCommandResult } from "../../services/autonomous-run-command-result.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";

/**
 * M37-WU01 (build spec: "aiqt autonomous result"; acceptance criterion:
 * "Return current or terminal result packet in human and JSON modes").
 * When the run has produced an evidence packet, this delegates entirely
 * to M36-WU04's buildAutonomousRunCommandResult -- the same M33-contract
 * wrapper the (currently unwired) real pipeline would use, so a real
 * adapter's future result renders through the identical path a simulated
 * one already exercises today.
 */
export interface AutonomousResultOptions {
  run?: string;
  configPath?: string;
  evidenceDir?: string;
}

export function runAutonomousResult(ctx: CommandContext, options: AutonomousResultOptions): CommandResult {
  if (!options.run || options.run.trim() === "") {
    return autonomousFailure("aiqt autonomous result requires --run <runId>.", ExitCode.InvalidInput, "AUTONOMOUS-RESULT-NO-RUN");
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
    return autonomousFailure(loaded.reason, ExitCode.InvalidInput, "AUTONOMOUS-RESULT-RUN-NOT-FOUND");
  }
  const record = loaded.record;

  if (!record.evidencePacket) {
    return makeResult({
      status: "needs_input",
      action: "autonomous",
      summary: `Run ${record.runId} has not produced a result yet (current status: "${record.status}").`,
      exitCode: ExitCode.HumanInputRequired,
      requiresHumanInput: true,
      data: { runId: record.runId, status: record.status, evidenceAvailable: false },
    });
  }

  return buildAutonomousRunCommandResult(record.evidencePacket);
}
