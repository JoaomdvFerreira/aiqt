import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { readJsonFile, FileReadError, JsonParseError } from "../../core/filesystem/file-store.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { runUpdate } from "./update.command.js";
import { runPlan } from "./plan.command.js";
import { runCheckpoint } from "./checkpoint.command.js";
import {
  isValidImportType,
  preferGuidedCommand,
  type ImportType,
  type ImportResultData,
} from "../../services/import-service.js";

export interface RunImportOptions {
  importType?: string;
  fromFile?: string;
  stdin?: boolean;
  /** M17/M17-RC1: plan import only -- forwarded to `aiqt plan --extend`. */
  extend?: boolean;
  refineWorkUnit?: string;
  /** @deprecated M17-RC1: use refineWorkUnit. Kept functional for M17 backward compatibility. */
  replacePlaceholder?: string;
  preview?: boolean;
}

/** Test-only dependency injection point; defaults to the real process.stdin. */
export interface RunImportDeps {
  stdin?: StdinLike;
}

type InputTransport =
  | { source: "file"; sourcePath: string; value: unknown }
  | { source: "stdin"; sourcePath: null; value: unknown };

/**
 * Preflight the supplied --from-file path before delegating: existence,
 * readability, and JSON-parseability only. Schema validation for the
 * specific import type stays owned by the delegated command. This prevents
 * a plain file-path mistake from being masked by a workflow-position gate
 * that the delegated command happens to check first (RC1 hardening).
 */
function preflightFromFile(
  importType: ImportType,
  fromFile: string,
): { ok: true; value: unknown } | { ok: false; result: CommandResult } {
  try {
    const value = readJsonFile(fromFile);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      return {
        ok: false,
        result: makeResult({
          status: "failed",
          action: "import",
          summary: err.message,
          nextRecommendedCommand: `aiqt prompt ${importType}`,
          exitCode: ExitCode.InvalidInput,
          blockingIssues: [
            {
              id: err instanceof FileReadError ? "IMPORT-FILE-NOT-FOUND" : "IMPORT-FILE-INVALID-JSON",
              severity: "critical",
              area: "input",
              message: err.message,
              agentCanFix: false,
            },
          ],
        }),
      };
    }
    throw err;
  }
}

/**
 * Read and parse stdin per §8.1: TTY input never blocks; empty input and
 * malformed JSON both fail with exit code 3 and no mutation.
 */
async function preflightStdin(
  importType: ImportType,
  stdin: StdinLike | undefined,
): Promise<{ ok: true; value: unknown } | { ok: false; result: CommandResult }> {
  if (isStdinInteractiveTty(stdin)) {
    const message = "--stdin requires piped input or redirected input.";
    return {
      ok: false,
      result: makeResult({
        status: "failed",
        action: "import",
        summary: message,
        nextRecommendedCommand: `aiqt prompt ${importType}`,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          { id: "IMPORT-STDIN-TTY", severity: "high", area: "input", message, agentCanFix: false },
        ],
      }),
    };
  }

  const raw = await readStdinText(stdin);
  if (raw.trim() === "") {
    const message = "Received empty input on stdin.";
    return {
      ok: false,
      result: makeResult({
        status: "failed",
        action: "import",
        summary: message,
        nextRecommendedCommand: `aiqt prompt ${importType}`,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          { id: "IMPORT-STDIN-EMPTY", severity: "high", area: "input", message, agentCanFix: false },
        ],
      }),
    };
  }

  try {
    const value = JSON.parse(raw);
    return { ok: true, value };
  } catch (err) {
    const message = `Malformed JSON on stdin: ${(err as Error).message}`;
    return {
      ok: false,
      result: makeResult({
        status: "failed",
        action: "import",
        summary: message,
        nextRecommendedCommand: `aiqt prompt ${importType}`,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          { id: "IMPORT-STDIN-INVALID-JSON", severity: "critical", area: "input", message, agentCanFix: false },
        ],
      }),
    };
  }
}

function delegateImport(
  ctx: CommandContext,
  importType: ImportType,
  transport: InputTransport,
  extension: {
    extend?: boolean;
    refineWorkUnit?: string;
    replacePlaceholder?: string;
    preview?: boolean;
  },
): Promise<CommandResult> {
  const options = transport.source === "file"
    ? { fromFile: transport.sourcePath }
    : { input: transport.value };
  switch (importType) {
    case "update":
      return runUpdate(ctx, options);
    case "plan":
      // M17/M17-RC1: --extend/--refine-work-unit/--replace-placeholder/
      // --preview pass through to the same append/refine engine
      // `aiqt plan --extend` uses -- this is not a second implementation.
      return Promise.resolve(runPlan(ctx, { ...options, ...extension }));
    case "checkpoint":
      return Promise.resolve(runCheckpoint(ctx, options));
  }
}

/**
 * aiqt import: a convenience router. It defines no new update/plan/checkpoint
 * semantics -- it validates the import type and input transport, reads and
 * preflights the JSON (from a file or from stdin), then delegates entirely
 * to the existing command behavior, only annotating the delegated
 * CommandResult with M7/M8 import context under data.import.
 */
export async function runImport(
  ctx: CommandContext,
  options: RunImportOptions,
  deps: RunImportDeps = {},
): Promise<CommandResult> {
  try {
    if (!options.importType || !isValidImportType(options.importType)) {
      const message = `Unsupported import type "${options.importType ?? ""}".`;
      return makeResult({
        status: "failed",
        action: "import",
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "IMPORT-UNSUPPORTED-TYPE",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }
    const importType: ImportType = options.importType;

    const hasFromFile = Boolean(options.fromFile);
    const hasStdin = Boolean(options.stdin);

    if (hasFromFile && hasStdin) {
      const message = "--stdin and --from-file are mutually exclusive. Choose one input mode.";
      return makeResult({
        status: "failed",
        action: "import",
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "IMPORT-INPUT-MODE-CONFLICT",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (!hasFromFile && !hasStdin) {
      return makeResult({
        status: "needs_input",
        action: "import",
        summary: `No input supplied for aiqt import ${importType}. Provide --stdin or --from-file <path>.`,
        requiresHumanInput: true,
        nextRecommendedCommand: `aiqt prompt ${importType}`,
        exitCode: ExitCode.HumanInputRequired,
      });
    }

    let transport: InputTransport;
    if (hasStdin) {
      const preflight = await preflightStdin(importType, deps.stdin);
      if (!preflight.ok) return preflight.result;
      transport = { source: "stdin", sourcePath: null, value: preflight.value };
    } else {
      const preflight = preflightFromFile(importType, options.fromFile!);
      if (!preflight.ok) return preflight.result;
      transport = { source: "file", sourcePath: options.fromFile!, value: preflight.value };
    }

    const delegated = await delegateImport(ctx, importType, transport, {
      extend: options.extend,
      refineWorkUnit: options.refineWorkUnit,
      replacePlaceholder: options.replacePlaceholder,
      preview: options.preview,
    });
    const nextRecommendedCommand = preferGuidedCommand(delegated.nextRecommendedCommand);

    const importData: ImportResultData = {
      importType,
      delegatedAction: importType,
      source: transport.source,
      sourcePath: transport.sourcePath,
      followUpCommand: nextRecommendedCommand,
      delegatedResultSummary: delegated.summary,
    };

    return {
      ...delegated,
      action: "import",
      nextRecommendedCommand,
      data: {
        ...((delegated.data as Record<string, unknown> | undefined) ?? {}),
        import: importData,
      },
    };
  } catch (err) {
    return errorToResult("import", err);
  }
}
