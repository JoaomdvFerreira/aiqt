import { join } from "node:path";
import { familyFailureResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { resolveAutonomousRunConfig } from "../../workflow/autonomous-run-config-resolution.js";
import { loadOperatorConfigFile } from "../../services/autonomous-run-operator-config-file.js";
import type { AutonomousOperatorConfig, AutonomousOperatorConfigPartial } from "../../schema/autonomous-run-operator.schema.js";

/**
 * M37-WU01: shared helpers reused by every `aiqt autonomous ...`
 * command file -- mirrors the established per-family pattern (e.g.
 * `workspace.command.ts`'s local `failure()`) rather than inventing a
 * new one.
 */

export const DEFAULT_OPERATOR_CONFIG_FILENAME = "aiqt.autonomous.config.json";

export function autonomousFailure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "autonomous", area: "autonomous", summary, exitCode, issueId });
}

export interface ResolveConfigParams {
  cwd: string;
  configPath?: string;
  cliFlags: AutonomousOperatorConfigPartial;
}

export type ResolveConfigOutcome = { ok: true; config: AutonomousOperatorConfig } | { ok: false; result: CommandResult };

/**
 * Loads the project configuration file (explicit `--config <path>`, or
 * the default filename in `cwd` if present -- never required to exist),
 * then resolves the full precedence chain via
 * autonomous-run-config-resolution.ts. A malformed config file fails
 * closed with a specific, actionable CommandResult rather than silently
 * falling back to defaults.
 */
export function resolveOperatorConfigOrFail(params: ResolveConfigParams): ResolveConfigOutcome {
  const configPath = params.configPath ?? join(params.cwd, DEFAULT_OPERATOR_CONFIG_FILENAME);
  const fileResult = loadOperatorConfigFile(configPath);
  if (!fileResult.ok) {
    return { ok: false, result: autonomousFailure(fileResult.reason, ExitCode.InvalidInput, "AUTONOMOUS-CONFIG-INVALID") };
  }
  const config = resolveAutonomousRunConfig({
    cliFlags: params.cliFlags,
    projectConfig: fileResult.config,
    env: process.env,
  });
  return { ok: true, config };
}
