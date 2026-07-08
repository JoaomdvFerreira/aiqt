#!/usr/bin/env node
import { buildProgram } from "./cli/register-commands.js";
import { ExitCode } from "./core/output/exit-codes.js";

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // commander's exitOverride throws for help/version and parse errors.
    // The exit code was already set on process.exitCode by the override or
    // command action. Help/version output is handled by commander itself.
    const e = err as { code?: string; exitCode?: number };
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
  }
}

void main();
