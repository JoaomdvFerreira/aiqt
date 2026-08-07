import { join } from "node:path";
import { loadExecutionGuidanceProfileConfigFile } from "./execution-guidance-profile-config-file.js";
import type { ExecutionGuidanceProfileConfigPartial } from "../schema/execution-guidance.schema.js";

/**
 * M39-WU03 (build spec Sec 5, "reuse the existing operator/project
 * configuration architecture"): mirrors
 * `autonomous-shared.ts#resolveOperatorConfigOrFail` (M37-WU01) --
 * default project-level filename in `cwd`, overridable by an explicit
 * path, never required to exist. Deliberately no CLI-flag/env-var layer
 * yet: nothing in this repository sets one, since no command is wired to
 * this resolver (that wiring, if any, belongs to a later Work Unit) --
 * adding an unused precedence chain now would be speculative complexity,
 * not reuse.
 */
export const DEFAULT_EXECUTION_GUIDANCE_PROFILE_CONFIG_FILENAME = "aiqt.execution-guidance.config.json";

export interface ResolveExecutionGuidanceProfileParams {
  cwd: string;
  configPath?: string;
}

export type ResolveExecutionGuidanceProfileOutcome =
  | { ok: true; config: ExecutionGuidanceProfileConfigPartial | null }
  | { ok: false; reason: string };

export function resolveExecutionGuidanceProfileConfig(params: ResolveExecutionGuidanceProfileParams): ResolveExecutionGuidanceProfileOutcome {
  const configPath = params.configPath ?? join(params.cwd, DEFAULT_EXECUTION_GUIDANCE_PROFILE_CONFIG_FILENAME);
  const fileResult = loadExecutionGuidanceProfileConfigFile(configPath);
  if (!fileResult.ok) return { ok: false, reason: fileResult.reason };
  return { ok: true, config: fileResult.config };
}
