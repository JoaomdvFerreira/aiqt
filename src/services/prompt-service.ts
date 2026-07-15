import { resolve, sep } from "node:path";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { AiqtPaths } from "../core/filesystem/paths.js";
import { isPlanningContextReady } from "../workflow/planning-readiness.js";
import { computeReviewNextCommand } from "../workflow/review-next-command.js";
import { renderUpdatePrompt } from "../templates/prompts/update.prompt.template.js";
import { renderPlanPrompt } from "../templates/prompts/plan.prompt.template.js";
import { renderCheckpointPrompt } from "../templates/prompts/checkpoint.prompt.template.js";
import { renderDriverPrompt } from "../templates/prompts/driver.prompt.template.js";
import { renderInterviewPrompt } from "../templates/prompts/interview.prompt.template.js";
import { resolveRoots } from "../workflow/root-resolution.js";
import type {
  FileBasedPromptKind,
  PromptResultData,
  DriverPromptData,
  InterviewPromptData,
} from "../schema/prompt-result.schema.js";

export type PromptAvailability =
  | { available: true }
  | { available: false; reason: string; nextRecommendedCommand: string };

/**
 * §9 required-state gates for each prompt kind, §13.2-13.4. update is always
 * available once initialized; plan requires a ready-but-empty context; and
 * checkpoint requires an in_progress work unit with a matching packet. Driver
 * and interview have no gate -- they are handled separately in
 * prompt.command.ts since they must work even before aiqt init.
 */
export function checkPromptAvailability(
  kind: FileBasedPromptKind,
  project: ProjectModel,
  state: StateModel,
): PromptAvailability {
  if (kind === "update") {
    return { available: true };
  }

  if (kind === "plan") {
    if (!isPlanningContextReady(project)) {
      return {
        available: false,
        reason: "Project context is not ready for planning yet.",
        nextRecommendedCommand: "aiqt update",
      };
    }
    if (state.workGraph.milestones.length > 0) {
      return {
        available: false,
        reason: "A work graph already exists. aiqt prompt plan is only for empty graphs.",
        nextRecommendedCommand: computeReviewNextCommand(project, state, []),
      };
    }
    return { available: true };
  }

  // checkpoint
  const currentWorkUnit = state.currentWorkUnitId
    ? state.workGraph.workUnits.find((wu) => wu.id === state.currentWorkUnitId)
    : undefined;
  if (!currentWorkUnit || currentWorkUnit.status !== "in_progress") {
    return {
      available: false,
      reason: "No work unit is currently in progress.",
      nextRecommendedCommand: "aiqt next",
    };
  }
  if (!state.lastAgentPacket || state.lastAgentPacket.workUnitId !== currentWorkUnit.id) {
    return {
      available: false,
      reason: "No agent packet metadata references the current work unit.",
      nextRecommendedCommand: "aiqt next",
    };
  }
  return { available: true };
}

function suggestedPathFor(kind: FileBasedPromptKind): string {
  return `.aiqt/inputs/${kind}.json`;
}

/**
 * M8 §9: the preferred agent path is now piping JSON directly into
 * aiqt import <kind> --stdin, rather than saving a temporary file first.
 */
function followUpFor(kind: FileBasedPromptKind): string {
  return `aiqt import ${kind} --stdin`;
}

/** Render prompt text for an available prompt kind. Caller must have already checked availability. */
export function renderPrompt(
  kind: FileBasedPromptKind,
  project: ProjectModel,
  state: StateModel,
  repoRoot: string | null = null,
): string {
  switch (kind) {
    case "update":
      return renderUpdatePrompt(project);
    case "plan":
      return renderPlanPrompt(project, repoRoot);
    case "checkpoint": {
      const workUnit = state.workGraph.workUnits.find(
        (wu) => wu.id === state.currentWorkUnitId,
      )!;
      const packet = state.lastAgentPacket!;
      // M16 §13.4: checkpoint guidance names the resolved implementation root.
      const roots = resolveRoots({
        controlRoot: repoRoot ?? process.cwd(),
        existingRepositoryPath: project.project.existingRepositoryPath,
      });
      return renderCheckpointPrompt(workUnit, packet, roots);
    }
  }
}

export function buildPromptResultData(params: {
  kind: FileBasedPromptKind;
  prompt: string;
  project: ProjectModel;
  state: StateModel;
  wroteFile: boolean;
  outputPath: string | null;
}): PromptResultData {
  const { kind, prompt, project, state, wroteFile, outputPath } = params;
  return {
    promptKind: kind,
    prompt,
    suggestedOutputPath: suggestedPathFor(kind),
    followUpCommand: followUpFor(kind),
    stateSummary: {
      planningContextReady: isPlanningContextReady(project),
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      nextRecommendedCommand: state.nextRecommendedCommand,
    },
    wroteFile,
    outputPath,
  };
}

/**
 * Build DriverPromptData for aiqt prompt driver (§6.1, §15). project/state
 * are null when .aiqt/ does not exist yet -- driver must remain usable
 * before init, unlike the file-based prompt kinds.
 */
export function buildDriverPromptData(params: {
  project: ProjectModel | null;
  state: StateModel | null;
  idea: string | null;
  repoRoot?: string | null;
}): DriverPromptData {
  const { project, state, idea, repoRoot = null } = params;
  const prompt = renderDriverPrompt({ project, state, idea, repoRoot });
  const nextRecommendedCommand = !project || !state ? "aiqt init" : (state.nextRecommendedCommand ?? "aiqt start");
  return {
    promptType: "driver",
    idea,
    prompt,
    preferredInputMode: "stdin",
    optionalInputMode: "from-file",
    nextRecommendedCommand,
  };
}

/**
 * Build InterviewPromptData for aiqt prompt interview (§7, §15). project is
 * null when .aiqt/ does not exist yet -- interview must remain usable
 * before init, unlike the file-based prompt kinds.
 */
export function buildInterviewPromptData(params: {
  project: ProjectModel | null;
  idea: string | null;
  repoRoot?: string | null;
}): InterviewPromptData {
  const { project, idea, repoRoot = null } = params;
  const { prompt, questions, detectedProjectType } = renderInterviewPrompt(project, idea, repoRoot);
  return {
    promptType: "interview",
    idea,
    detectedProjectType,
    questions,
    prompt,
    followUpCommand: "aiqt import update --stdin",
  };
}

/**
 * Validate that a --out path resolves to a location strictly inside
 * .aiqt/inputs/. Returns the resolved absolute path, or null if the path is
 * the inputs dir itself or falls outside it.
 */
export function validateOutPath(paths: AiqtPaths, outPath: string): string | null {
  const resolved = resolve(paths.root, outPath);
  const inputsDirWithSep = paths.inputsDir.endsWith(sep) ? paths.inputsDir : paths.inputsDir + sep;
  if (resolved === paths.inputsDir) return null;
  if (!resolved.startsWith(inputsDirWithSep)) return null;
  return resolved;
}
