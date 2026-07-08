import type { CommandResult } from "./result.js";

/**
 * Render a CommandResult as deterministic, pretty-printed JSON.
 * Key order follows the CommandResult object construction order, which is
 * stable across runs, so output is byte-for-byte reproducible.
 */
export function renderJson(result: CommandResult): string {
  return JSON.stringify(result, null, 2);
}
