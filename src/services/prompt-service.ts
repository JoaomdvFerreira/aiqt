import { resolve, sep } from "node:path";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { AiqtPaths } from "../core/filesystem/paths.js";
import { isPlanningContextReady } from "../workflow/planning-readiness.js";
import { computeReviewNextCommand } from "../workflow/review-next-command.js";
import { renderUpdatePrompt } from "../templates/prompts/update.prompt.template.js";
import { renderPlanPrompt } from "../templates/prompts/plan.prompt.template.js";
import { renderCheckpointPrompt } from "../templates/prompts/checkpoint.prompt.template.js";
import type { PromptKind, PromptResultData } from "../schema/prompt-result.schema.js";

export type PromptAvailability =
  | { available: true }
  | { available: false; reason: string; nextRecommendedCommand: string };

/**
 * §9 required-state gates for each prompt kind, §13.2-13.4. update is always
 * available once initialized; plan requires a ready-but-empty context; and
 * checkpoint requires an in_progress work unit with a matching packet.
 */
export function checkPromptAvailability(
  kind: PromptKind,
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

function suggestedPathFor(kind: PromptKind): string {
  return `.aiqt/inputs/${kind}.json`;
}

function followUpFor(kind: PromptKind): string {
  return `aiqt import ${kind} --from-file .aiqt/inputs/${kind}.json`;
}

/** Render prompt text for an available prompt kind. Caller must have already checked availability. */
export function renderPrompt(kind: PromptKind, project: ProjectModel, state: StateModel): string {
  switch (kind) {
    case "update":
      return renderUpdatePrompt(project);
    case "plan":
      return renderPlanPrompt(project);
    case "checkpoint": {
      const workUnit = state.workGraph.workUnits.find(
        (wu) => wu.id === state.currentWorkUnitId,
      )!;
      const packet = state.lastAgentPacket!;
      return renderCheckpointPrompt(workUnit, packet);
    }
  }
}

export function buildPromptResultData(params: {
  kind: PromptKind;
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
