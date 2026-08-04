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

/**
 * M33-WU03: whether `--json` appears anywhere in the raw process argv. Used
 * only by the parser-level error path (src/index.ts, register-commands.ts's
 * root .exitOverride()), which runs BEFORE commander has finished parsing
 * options into a normal CommandContext -- at that point there is no parsed
 * `raw.json` to consult yet, so the raw argv is the only signal available.
 * `--json` is a simple boolean flag with no combining short forms in this
 * CLI's option surface, so a literal substring check is sufficient and
 * matches every real invocation.
 */
export function argvRequestsJson(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--json");
}
