import { Command } from "commander";
import { makeContext } from "./command-context.js";
import {
  normalizeInitOptions,
  collectRepeatable,
  type RawInitOptions,
  type RawUpdateOptions,
  type RawPlanOptions,
} from "./options.js";
import { runInit } from "./commands/init.command.js";
import { runStatus } from "./commands/status.command.js";
import { runNext } from "./commands/next.command.js";
import { runUpdate } from "./commands/update.command.js";
import { runPlan } from "./commands/plan.command.js";
import { EXAMPLE_PLAN_INPUT } from "./commands/plan-example.js";
import { errorToResult } from "../core/output/result.js";
import { renderJson } from "../core/output/json-output.js";
import { renderHuman } from "../core/output/human-output.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
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
    .description("Select the next ready work unit and generate its agent handoff packet")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runNext(ctx);

      // On successful packet generation, human-mode output is the packet
      // text itself (paste-ready for a coding agent), not the usual
      // CommandResult summary wrapper.
      if (!ctx.json && result.exitCode === ExitCode.Success) {
        const data = result.data as { packet?: string } | undefined;
        if (typeof data?.packet === "string") {
          process.stdout.write(data.packet + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  program
    .command("update")
    .description("Capture durable project context")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load a JSON update patch from a file")
    .option("--objective <objective>", "project objective")
    .option(
      "--target-user <targetUser>",
      "target user (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option("--agent <agent>", "preferred coding agent")
    .option("--repository-path <path>", "existing repository path")
    .action(async (raw: RawUpdateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runUpdate(ctx, raw);
      emit(result, ctx.json);
    });

  program
    .command("plan")
    .description("Ingest a structured plan into the canonical work graph")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load a JSON plan input file")
    .option("--example", "print a sample plan input JSON and exit", false)
    .action((raw: RawPlanOptions) => {
      if (raw.example && raw.json) {
        const result = errorToResult(
          "plan",
          new AiqtError(
            "aiqt plan --example cannot be combined with --json.",
            ExitCode.InvalidInput,
            {
              id: "PLAN-EXAMPLE-JSON-CONFLICT",
              severity: "critical",
              area: "input",
              message: "aiqt plan --example cannot be combined with --json.",
              agentCanFix: false,
            },
          ),
        );
        emit(result, true);
        return;
      }

      if (raw.example) {
        process.stdout.write(JSON.stringify(EXAMPLE_PLAN_INPUT, null, 2) + "\n");
        process.exitCode = ExitCode.Success;
        return;
      }

      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPlan(ctx, { fromFile: raw.fromFile });
      emit(result, ctx.json);
    });

  return program;
}
