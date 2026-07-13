import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { runUpdate } from "./update.command.js";
import { runPlan } from "./plan.command.js";
import { runCheckpoint } from "./checkpoint.command.js";
import { isValidImportType, type ImportType } from "../../services/import-service.js";

export interface RunImportOptions {
  importType?: string;
  fromFile?: string;
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

    const delegated = await delegateImport(ctx, importType, options.fromFile);

    return {
      ...delegated,
      action: "import",
      data: {
        ...((delegated.data as Record<string, unknown> | undefined) ?? {}),
        import: {
          importType,
          sourcePath: options.fromFile,
          delegatedAction: importType,
          followUpCommand: delegated.nextRecommendedCommand,
        },
      },
    };
  } catch (err) {
    return errorToResult("import", err);
  }
}
