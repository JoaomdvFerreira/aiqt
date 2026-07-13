import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { readJsonFile, FileReadError, JsonParseError } from "../../core/filesystem/file-store.js";
import { runUpdate } from "./update.command.js";
import { runPlan } from "./plan.command.js";
import { runCheckpoint } from "./checkpoint.command.js";
import {
  isValidImportType,
  preferGuidedCommand,
  type ImportType,
} from "../../services/import-service.js";

export interface RunImportOptions {
  importType?: string;
  fromFile?: string;
}

/**
 * Preflight the supplied --from-file path before delegating: existence,
 * readability, and JSON-parseability only. Schema validation for the
 * specific import type stays owned by the delegated command. This prevents
 * a plain file-path mistake from being masked by a workflow-position gate
 * that the delegated command happens to check first (RC1 hardening).
 */
function preflightFromFile(importType: ImportType, fromFile: string): CommandResult | null {
  try {
    readJsonFile(fromFile);
    return null;
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      return makeResult({
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
      });
    }
    throw err;
  }
}

function delegateImport(
  ctx: CommandContext,
  importType: ImportType,
  fromFile: string,
): Promise<CommandResult> {
  switch (importType) {
    case "update":
      return runUpdate(ctx, { fromFile });
    case "plan":
      return Promise.resolve(runPlan(ctx, { fromFile }));
    case "checkpoint":
      return Promise.resolve(runCheckpoint(ctx, { fromFile }));
  }
}

/**
 * aiqt import: a convenience router. It defines no new update/plan/checkpoint
 * semantics -- it validates the import type and --from-file presence, then
 * delegates entirely to the existing command behavior, only annotating the
 * delegated CommandResult with M7 import context under data.import.
 */
export async function runImport(
  ctx: CommandContext,
  options: RunImportOptions,
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

    if (!options.fromFile) {
      return makeResult({
        status: "needs_input",
        action: "import",
        summary: `No --from-file supplied for aiqt import ${importType}.`,
        requiresHumanInput: true,
        nextRecommendedCommand: `aiqt import ${importType} --from-file <path>`,
        exitCode: ExitCode.HumanInputRequired,
      });
    }

    const preflightFailure = preflightFromFile(importType, options.fromFile);
    if (preflightFailure) {
      return preflightFailure;
    }

    const delegated = await delegateImport(ctx, importType, options.fromFile);
    const nextRecommendedCommand = preferGuidedCommand(delegated.nextRecommendedCommand);

    return {
      ...delegated,
      action: "import",
      nextRecommendedCommand,
      data: {
        ...((delegated.data as Record<string, unknown> | undefined) ?? {}),
        import: {
          importType,
          sourcePath: options.fromFile,
          delegatedAction: importType,
          followUpCommand: nextRecommendedCommand,
        },
      },
    };
  } catch (err) {
    return errorToResult("import", err);
  }
}
