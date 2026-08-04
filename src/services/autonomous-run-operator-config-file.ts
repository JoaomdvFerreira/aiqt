import { existsSync, readFileSync } from "node:fs";
import { AutonomousOperatorConfigPartialSchema, type AutonomousOperatorConfigPartial } from "../schema/autonomous-run-operator.schema.js";

/**
 * M37-WU01: reads the operator's project-level configuration file (JSON,
 * a partial AutonomousOperatorConfig -- any subset of fields). A missing
 * file is not an error (`ok: true, config: null`) -- project configuration
 * is optional at every layer of the precedence chain. A malformed file
 * (unreadable, invalid JSON, or schema-invalid) fails closed with a
 * specific reason, never silently ignored -- a config file that exists
 * but cannot be parsed is far more likely to indicate the operator's
 * intent was not honored than that it should be skipped.
 */
export type LoadOperatorConfigFileResult = { ok: true; config: AutonomousOperatorConfigPartial | null } | { ok: false; reason: string };

export function loadOperatorConfigFile(path: string): LoadOperatorConfigFileResult {
  if (!existsSync(path)) return { ok: true, config: null };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `Failed to read operator config file "${path}": ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `Operator config file is not valid JSON: ${path}` };
  }

  const result = AutonomousOperatorConfigPartialSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: `Operator config file failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }
  return { ok: true, config: result.data };
}
