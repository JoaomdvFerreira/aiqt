import { Command } from "commander";
import { makeContext } from "./command-context.js";
import { normalizeInitOptions, type RawInitOptions } from "./options.js";
import { runInit } from "./commands/init.command.js";
import { runStatus } from "./commands/status.command.js";
import { runNext } from "./commands/next.command.js";
import { renderJson } from "../core/output/json-output.js";
import { renderHuman } from "../core/output/human-output.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type { CommandResult } from "../core/output/result.js";

/** Emit a CommandResult and set the process exit code. */
function emit(result: CommandResult, json: boolean): void {
  const text = json ? renderJson(result) : renderHuman(result);
  if (result.exitCode === ExitCode.Success) {
    process.stdout.write(text + "\n");
  } else {
    process.stderr.write(text + "\n");
  }
  process.exitCode = result.exitCode;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("aiqt")
    .description("AIQT CLI - local workflow state engine")
    .version("0.5.0")
    // Unknown commands / bad input exit with code 3.
    .exitOverride((err) => {
      // commander throws for help/version (exit 0) and parse errors.
      const code =
        err.exitCode === 0 ? ExitCode.Success : ExitCode.InvalidInput;
      process.exitCode = code;
      throw err;
    });

  program
    .command("init")
    .description("Initialize a new AIQT project in the current folder")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--objective <objective>", "project objective")
    .option("--target-user <targetUser>", "primary target user")
    .option("--agent <agent>", "preferred coding agent")
    .action((raw: RawInitOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runInit(ctx, normalizeInitOptions(raw));
      emit(result, ctx.json);
    });

  program
    .command("status")
    .description("Inspect current AIQT state without modifying files")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runStatus(ctx);
      emit(result, ctx.json);
    });

  program
    .command("next")
    .description("Report the next required workflow action")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runNext(ctx);
      emit(result, ctx.json);
    });

  return program;
}
