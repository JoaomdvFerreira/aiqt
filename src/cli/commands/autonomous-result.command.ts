import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { buildAutonomousRunCommandResult } from "../../services/autonomous-run-command-result.js";
import { exportAutonomousRunPatch } from "../../services/autonomous-run-patch-export-service.js";
import { buildAutonomousPrDraft } from "../../workflow/autonomous-run-pr-draft.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";

/**
 * M37-WU01/WU04 (build spec: "aiqt autonomous result"; acceptance
 * criterion: "Return current or terminal result packet in human and
 * JSON modes"; WU37-04: "branch result; patch export; ... PR draft
 * text"). When the run has produced an evidence packet, this delegates
 * entirely to M36-WU04's buildAutonomousRunCommandResult, then --
 * only if `--patch`/`--pr-draft` was requested -- layers on a real,
 * read-only patch export (autonomous-run-patch-export-service.ts) and/or
 * a pure PR draft text generation (autonomous-run-pr-draft.ts). Neither
 * pushes, merges, or contacts any Git host -- the operator copies this
 * text themselves.
 */
export interface AutonomousResultOptions {
  run?: string;
  patch?: boolean;
  prDraft?: boolean;
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

  const baseResult = buildAutonomousRunCommandResult(record.evidencePacket);
  if (!options.patch && !options.prDraft) return baseResult;

  const extra: Record<string, unknown> = {};

  if (options.patch) {
    if (!record.evidencePacket.workspace) {
      return autonomousFailure(`Run ${record.runId} has no workspace/branch to export a patch from (it never reached real execution).`, ExitCode.InvalidInput, "AUTONOMOUS-RESULT-NO-WORKSPACE-FOR-PATCH");
    }
    const patchResult = exportAutonomousRunPatch(record.evidencePacket.workspace.sourceRepository, record.evidencePacket.workspace.baseCommit, record.evidencePacket.workspace.branch);
    if (!patchResult.ok) {
      return autonomousFailure(patchResult.reason, ExitCode.InvalidInput, "AUTONOMOUS-RESULT-PATCH-EXPORT-FAILED");
    }
    extra.patch = patchResult.patch;
  }

  if (options.prDraft) {
    extra.prDraft = buildAutonomousPrDraft(record.candidate, record.evidencePacket);
  }

  return { ...baseResult, data: { ...(baseResult.data as object), ...extra } };
}
