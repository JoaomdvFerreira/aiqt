#!/usr/bin/env node
import { buildProgram } from "./cli/register-commands.js";
import { ExitCode } from "./core/output/exit-codes.js";
import { argvRequestsJson } from "./cli/command-context.js";
import { parserErrorToResult } from "./core/output/result.js";
import { renderJson } from "./core/output/json-output.js";

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // commander's exitOverride throws for help/version and parse errors.
    // The exit code was already set on process.exitCode by the override or
    // command action. Help/version output is handled by commander itself.
    const e = err as { code?: string; message?: string; exitCode?: number };
    if (
      e.code === "commander.helpDisplayed" ||
      e.code === "commander.version" ||
      e.code === "commander.help"
    ) {
      process.exitCode = ExitCode.Success;
      return;
    }
    if (process.exitCode === undefined || process.exitCode === 0) {
      process.exitCode = ExitCode.InvalidInput;
    }
    // M33-WU03 Sec 5.4: a genuine parser-level error (unknown command,
    // unknown option, missing required argument, ...). Commander's own raw
    // error text was already suppressed by register-commands.ts's
    // configureOutput() when --json was requested; construct and emit the
    // canonical CommandResult JSON here instead, to the same stream
    // register-commands.ts's emit() uses for --json (stdout, per Sec 5.5).
    if (argvRequestsJson()) {
      const result = parserErrorToResult(e);
      process.stdout.write(renderJson(result) + "\n");
      process.exitCode = result.exitCode;
    }
  }
}

void main();
