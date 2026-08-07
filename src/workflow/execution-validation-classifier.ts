import type { ValidationTier } from "../schema/execution-guidance.schema.js";

/**
 * M39-WU04 (build spec Sec 7, "Existing validation commands"): a pure,
 * conservative classifier over an existing Work Unit's own
 * `validationCommands: string[]` entries. Never removes/renames a
 * command -- this only labels a copy of the string with the tier it
 * conservatively believes the command covers, for guidance purposes.
 * "Obvious repository-wide commands may be classified conservatively as
 * full"; anything not matching a known, reviewed pattern is
 * `unclassified` -- never guessed into a lenient tier. This repository's
 * own script names (`pnpm typecheck`/`lint`/`build`/`test`/`validate`,
 * `tsc`, `eslint .`, `vitest run <path>`) are the only patterns
 * recognized; a consuming project's own script names are free to differ,
 * in which case `unclassified` is the correct, safe answer.
 */
export function classifyValidationCommand(command: string): ValidationTier {
  const normalized = command.trim().toLowerCase();
  if (normalized.length === 0) return "unclassified";

  if (normalized.includes("milestone")) return "milestone";
  if (normalized.includes("impacted")) return "impacted";

  // Repository-wide, whole-suite commands (build spec: "obvious
  // repository-wide commands may be classified conservatively as full").
  const FULL_SUITE_PATTERNS = [/^(pnpm|npm run|npm|yarn)\s+validate$/, /^(pnpm|npm run|npm|yarn)\s+test$/, /^vitest\s+run$/, /^vitest$/];
  if (FULL_SUITE_PATTERNS.some((p) => p.test(normalized))) return "full";

  // Structural checks (T0).
  const STATIC_PATTERNS = [/^(pnpm|npm run|npm|yarn)\s+typecheck$/, /^(pnpm|npm run|npm|yarn)\s+lint$/, /^(pnpm|npm run|npm|yarn)\s+build$/, /^tsc(\s+--noemit)?$/, /^eslint\b/];
  if (STATIC_PATTERNS.some((p) => p.test(normalized))) return "static";

  // A scoped vitest invocation naming a specific path is focused, never
  // "the whole suite" -- distinct from the bare `vitest run`/`vitest`
  // patterns above.
  if (/^vitest\s+run\s+\S+/.test(normalized)) return "focused";

  return "unclassified";
}

export interface ClassifiedValidationCommand {
  command: string;
  tier: ValidationTier;
}

export function classifyValidationCommands(commands: readonly string[]): ClassifiedValidationCommand[] {
  return commands.map((command) => ({ command, tier: classifyValidationCommand(command) }));
}
