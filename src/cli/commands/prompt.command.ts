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
  buildDriverPromptData,
  buildInterviewPromptData,
  validateOutPath,
} from "../../services/prompt-service.js";

export interface RunPromptOptions {
  kind?: string;
  out?: string;
  idea?: string;
}

/**
 * aiqt prompt driver / aiqt prompt interview (§6, §7): unlike the file-based
 * prompt kinds, these must remain usable before aiqt init, so .aiqt/ is
 * loaded best-effort rather than required. A malformed project/state file
 * still surfaces as a normal failure via the outer catch in runPrompt.
 */
function runDriverOrInterviewPrompt(
  ctx: CommandContext,
  kind: "driver" | "interview",
  idea: string | null,
): CommandResult {
  const dirExists = aiqtDirExists(ctx);
  const loaded = dirExists ? loadProject(ctx) : null;
  const project = loaded?.project ?? null;
  const state = loaded?.state ?? null;

  const data = kind === "driver"
    ? buildDriverPromptData({ project, state, idea })
    : buildInterviewPromptData({ project, idea });
  const nextRecommendedCommand = kind === "driver"
    ? (data as ReturnType<typeof buildDriverPromptData>).nextRecommendedCommand
    : (data as ReturnType<typeof buildInterviewPromptData>).followUpCommand;

  return makeResult({
    status: "passed",
    action: "prompt",
    projectStatus: state?.projectStatus ?? null,
    currentMilestoneId: state?.currentMilestoneId ?? null,
    currentWorkUnitId: state?.currentWorkUnitId ?? null,
    summary: kind === "driver" ? "Generated agent driver prompt." : "Generated planning interview prompt.",
    completedActions: [kind === "driver" ? "Rendered driver prompt" : "Rendered interview prompt"],
    changedFiles: [],
    affectedItems: project ? [project.project.id] : [],
    nextRecommendedCommand,
    exitCode: ExitCode.Success,
    data,
  });
}

export function runPrompt(ctx: CommandContext, options: RunPromptOptions): CommandResult {
  try {
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

    if (kind === "driver" || kind === "interview") {
      return runDriverOrInterviewPrompt(ctx, kind, options.idea ?? null);
    }

    // .aiqt/ missing: exit code 3, not 2 (only valid workflow-position
    // blocks use exit code 2). update/plan/checkpoint prompts require an
    // initialized project; driver/interview (handled above) do not.
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

      const writtenData = buildPromptResultData({
        kind,
        prompt,
        project,
        state,
        wroteFile: true,
        outputPath: options.out,
      });

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
        // Recommend the guided follow-up (e.g. "aiqt import plan --from-file
        // ...") rather than the raw state.nextRecommendedCommand, so users
        // are not steered back toward hand-authoring JSON.
        nextRecommendedCommand: writtenData.followUpCommand,
        exitCode: ExitCode.Success,
        data: writtenData,
      });
    }

    const stdoutData = buildPromptResultData({
      kind,
      prompt,
      project,
      state,
      wroteFile: false,
      outputPath: null,
    });

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
      nextRecommendedCommand: stdoutData.followUpCommand,
      exitCode: ExitCode.Success,
      data: stdoutData,
    });
  } catch (err) {
    return errorToResult("prompt", err);
  }
}
