import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import { isPlanningContextReady } from "./planning-readiness.js";
import { computeReviewNextCommand } from "./review-next-command.js";
import type { GuidanceResultData, GuidanceStage } from "../schema/guidance-result.schema.js";

export interface GuidanceContext {
  project: ProjectModel;
  state: StateModel;
  /** Whether .aiqt/inputs/checkpoint.json already exists on disk. */
  checkpointInputExists: boolean;
}

function mapFallbackStage(command: string): GuidanceStage {
  switch (command) {
    case "aiqt update":
      return "needs_context";
    case "aiqt plan":
      return "needs_plan";
    case "aiqt next":
      return "ready_for_handoff";
    case "aiqt checkpoint":
      return "awaiting_checkpoint";
    case "aiqt export all":
      return "ready_for_export";
    default:
      return "needs_review";
  }
}

/**
 * Deterministic guided-navigation engine (§8). Rules are evaluated
 * top-to-bottom; the first matching row wins. This function does not read
 * files or mutate anything -- it is a pure classification over already
 * loaded project/state, reused identically by aiqt start and aiqt continue.
 *
 * Row 1 (.aiqt missing) and the final row (canonical files invalid) are
 * handled by the caller before/around this function, since they occur before
 * or during project/state loading rather than as a state classification.
 */
export function computeGuidance(ctx: GuidanceContext): GuidanceResultData {
  const { project, state, checkpointInputExists } = ctx;
  const workUnits = state.workGraph.workUnits;
  const hasWorkGraph = state.workGraph.milestones.length > 0;
  const planningContextReady = isPlanningContextReady(project);

  // Row 2: initialized but planning context not ready.
  if (!planningContextReady) {
    return {
      stage: "needs_context",
      guidance:
        "Project context is not ready for planning yet. Capture more context with aiqt update, or generate a prompt for an agent with aiqt prompt update.",
      recommendedCommand: "aiqt update",
      alternativeCommands: ["aiqt prompt update"],
      promptCommand: "aiqt prompt update",
      expectedInputPath: ".aiqt/inputs/update.json",
      followUpCommand: "aiqt import update --stdin",
      canProceedWithoutAgent: true,
    };
  }

  // Row 3: planning context ready and work graph is empty.
  if (!hasWorkGraph) {
    return {
      stage: "needs_plan",
      guidance:
        "Planning context is ready. Generate a plan prompt, ask Claude Code or Codex to return plan JSON, then import it.",
      recommendedCommand: "aiqt prompt plan",
      alternativeCommands: ["aiqt plan --from-file <path>"],
      promptCommand: "aiqt prompt plan --out .aiqt/inputs/plan.prompt.md",
      expectedInputPath: ".aiqt/inputs/plan.json",
      followUpCommand: "aiqt import plan --stdin",
      canProceedWithoutAgent: false,
    };
  }

  // Row 4: work graph has ready work and nothing is currently active.
  const hasReady = workUnits.some((wu) => wu.status === "ready");
  if (hasReady && state.currentWorkUnitId === null) {
    return {
      stage: "ready_for_handoff",
      guidance:
        "A work unit is ready. Run aiqt next and paste the generated packet into the coding agent.",
      recommendedCommand: "aiqt next",
      alternativeCommands: [],
      promptCommand: null,
      expectedInputPath: null,
      followUpCommand: "aiqt prompt checkpoint",
      canProceedWithoutAgent: true,
    };
  }

  // Row 5: currentWorkUnitId references an in_progress work unit.
  const currentWorkUnit = state.currentWorkUnitId
    ? (workUnits.find((wu) => wu.id === state.currentWorkUnitId) ?? null)
    : null;
  if (currentWorkUnit && currentWorkUnit.status === "in_progress") {
    return {
      stage: "awaiting_checkpoint",
      guidance:
        "A work unit is in progress. After the coding agent reports results, generate a checkpoint prompt and import the returned JSON.",
      recommendedCommand: "aiqt prompt checkpoint",
      alternativeCommands: ["aiqt checkpoint --from-file <path>"],
      promptCommand: "aiqt prompt checkpoint --out .aiqt/inputs/checkpoint.prompt.md",
      expectedInputPath: ".aiqt/inputs/checkpoint.json",
      followUpCommand: "aiqt import checkpoint --stdin",
      canProceedWithoutAgent: checkpointInputExists,
    };
  }

  // Row 6: one or more work units need review.
  const hasNeedsReview = workUnits.some((wu) => wu.status === "needs_review");
  if (hasNeedsReview) {
    return {
      stage: "needs_review",
      guidance:
        "One or more work units need review. Run aiqt review and resolve the findings manually or through a future workflow.",
      recommendedCommand: "aiqt review",
      alternativeCommands: [],
      promptCommand: null,
      expectedInputPath: null,
      followUpCommand: null,
      canProceedWithoutAgent: true,
    };
  }

  // Row 7: all work is done.
  if (workUnits.length > 0 && workUnits.every((wu) => wu.status === "done")) {
    return {
      stage: "ready_for_export",
      guidance: "All work is done. Run aiqt review, then aiqt export all.",
      recommendedCommand: "aiqt review",
      alternativeCommands: ["aiqt export all"],
      promptCommand: null,
      expectedInputPath: null,
      followUpCommand: "aiqt export all",
      canProceedWithoutAgent: true,
    };
  }

  // Fallback: no explicit table row matches (e.g. remaining work units are
  // blocked on unmet dependencies). Reuse the M6 review next-command
  // precedence rather than inventing new logic, per the guidance-source rule.
  const fallbackCommand = computeReviewNextCommand(project, state, []);
  return {
    stage: mapFallbackStage(fallbackCommand),
    guidance: `Run ${fallbackCommand}.`,
    recommendedCommand: fallbackCommand,
    alternativeCommands: [],
    promptCommand: null,
    expectedInputPath: null,
    followUpCommand: null,
    canProceedWithoutAgent: true,
  };
}
