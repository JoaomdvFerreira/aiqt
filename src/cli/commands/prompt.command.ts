import { mkdirSync } from "node:fs";
import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeTextFile } from "../../core/filesystem/safe-writer.js";
import { isFile } from "../../core/filesystem/file-exists.js";
import { isValidPromptKind, type PromptKind } from "../../schema/prompt-result.schema.js";
import {
  checkPromptAvailability,
  renderPrompt,
  buildPromptResultData,
  validateOutPath,
} from "../../services/prompt-service.js";

export interface RunPromptOptions {
  kind?: string;
  out?: string;
}

export function runPrompt(ctx: CommandContext, options: RunPromptOptions): CommandResult {
  try {
    // .aiqt/ missing: exit code 3, not 2 (only valid workflow-position
    // blocks use exit code 2).
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "prompt",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "PROMPT-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    if (!options.kind || !isValidPromptKind(options.kind)) {
      const message = `Unsupported prompt kind "${options.kind ?? ""}".`;
      return makeResult({
        status: "failed",
        action: "prompt",
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "PROMPT-UNSUPPORTED-KIND",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }
    const kind: PromptKind = options.kind;

    const { paths, project, state } = loadProject(ctx);

    const availability = checkPromptAvailability(kind, project, state);
    if (!availability.available) {
      return makeResult({
        status: "blocked",
        action: "prompt",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: availability.reason,
        nextRecommendedCommand: availability.nextRecommendedCommand,
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "PROMPT-INVALID-WORKFLOW-POSITION",
            severity: "high",
            area: "workflow",
            message: availability.reason,
            agentCanFix: false,
          },
        ],
      });
    }

    const prompt = renderPrompt(kind, project, state);

    if (options.out) {
      const resolvedPath = validateOutPath(paths, options.out);
      if (!resolvedPath) {
        const message = `--out path "${options.out}" must be a file under .aiqt/inputs/.`;
        return makeResult({
          status: "failed",
          action: "prompt",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: message,
          nextRecommendedCommand: null,
          exitCode: ExitCode.InvalidInput,
          blockingIssues: [
            {
              id: "PROMPT-OUT-PATH-INVALID",
              severity: "high",
              area: "input",
              message,
              agentCanFix: false,
            },
          ],
        });
      }

      if (isFile(resolvedPath)) {
        const message = `${options.out} already exists. aiqt prompt does not overwrite existing files by default.`;
        return makeResult({
          status: "blocked",
          action: "prompt",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: message,
          nextRecommendedCommand: `aiqt prompt ${kind} --out <different-path>`,
          exitCode: ExitCode.WorkflowBlocked,
          blockingIssues: [
            {
              id: "PROMPT-OUT-EXISTS",
              severity: "medium",
              area: "filesystem",
              message,
              suggestedAction: "Choose a different --out path.",
              agentCanFix: false,
            },
          ],
        });
      }

      mkdirSync(paths.inputsDir, { recursive: true });
      writeTextFile(resolvedPath, prompt);

      return makeResult({
        status: "passed",
        action: "prompt",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Prompt written to ${options.out}.`,
        completedActions: ["Read project.json", "Read state.json", "Rendered prompt", "Wrote prompt file"],
        changedFiles: [resolvedPath],
        affectedItems: [project.project.id],
        nextRecommendedCommand: state.nextRecommendedCommand,
        exitCode: ExitCode.Success,
        data: buildPromptResultData({
          kind,
          prompt,
          project,
          state,
          wroteFile: true,
          outputPath: options.out,
        }),
      });
    }

    return makeResult({
      status: "passed",
      action: "prompt",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Generated ${kind} prompt.`,
      completedActions: ["Read project.json", "Read state.json", "Rendered prompt"],
      changedFiles: [],
      affectedItems: [project.project.id],
      nextRecommendedCommand: state.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: buildPromptResultData({
        kind,
        prompt,
        project,
        state,
        wroteFile: false,
        outputPath: null,
      }),
    });
  } catch (err) {
    return errorToResult("prompt", err);
  }
}
