export interface CommandContext {
  /** Working directory the command operates in (defaults to process.cwd()). */
  cwd: string;
  /** Whether to emit machine-readable JSON instead of human text. */
  json: boolean;
}

export function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cwd: overrides.cwd ?? process.cwd(),
    json: overrides.json ?? false,
  };
}
