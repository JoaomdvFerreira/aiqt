import { existsSync, readFileSync } from "node:fs";
import {
  ExecutionGuidanceProfileConfigPartialSchema,
  type ExecutionGuidanceProfileConfigPartial,
} from "../schema/execution-guidance.schema.js";

/**
 * M39-WU01: reads the operator's optional project-level concrete
 * agent-profile mapping file (JSON, a partial
 * ExecutionGuidanceProfileConfig). Deliberately mirrors
 * autonomous-run-operator-config-file.ts's `loadOperatorConfigFile`
 * (M37-WU01) field-for-field: a missing file is not an error (`ok: true,
 * config: null`) -- concrete profile configuration is optional, and
 * generic class/effort guidance must work without it -- while a malformed
 * file (unreadable, invalid JSON, or schema-invalid) fails closed with a
 * specific reason rather than being silently ignored.
 */
export type LoadExecutionGuidanceProfileConfigResult =
  | { ok: true; config: ExecutionGuidanceProfileConfigPartial | null }
  | { ok: false; reason: string };

export function loadExecutionGuidanceProfileConfigFile(path: string): LoadExecutionGuidanceProfileConfigResult {
  if (!existsSync(path)) return { ok: true, config: null };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `Failed to read execution-guidance profile config file "${path}": ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `Execution-guidance profile config file is not valid JSON: ${path}` };
  }

  const result = ExecutionGuidanceProfileConfigPartialSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: `Execution-guidance profile config file failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }
  return { ok: true, config: result.data };
}
