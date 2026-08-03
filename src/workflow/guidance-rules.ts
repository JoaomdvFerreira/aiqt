import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { GuidanceResultData, GuidanceStage } from "../schema/guidance-result.schema.js";
import { assessWorkflow, type WorkflowAssessment } from "./workflow-assessment.js";

export interface GuidanceContext {
  project: ProjectModel;
  state: StateModel;
  /** Whether .aiqt/inputs/checkpoint.json already exists on disk. */
  checkpointInputExists: boolean;
  productionReady?: boolean | null;
}

function stageForAssessment(assessment: WorkflowAssessment): GuidanceStage {
  switch (assessment.workflowPosition) {
    case "invalid_state":
      return "invalid_state";
    case "incomplete_context":
      return "needs_context";
    case "planning_ready_no_graph":
      return "needs_plan";
    case "ready_work":
      return "ready_for_handoff";
    case "active_in_progress":
      return "awaiting_checkpoint";
    case "needs_review":
      return "needs_review";
    case "development_complete":
    case "development_complete_production_not_ready":
    case "terminal_export_reporting":
      return "ready_for_export";
    case "stale_ready_work":
    case "no_actionable_command":
      return "needs_review";
  }
}

function expectedInputPath(assessment: WorkflowAssessment): string | null {
  switch (assessment.recommendedCommand) {
    case "aiqt update":
      return ".aiqt/inputs/update.json";
    case "aiqt plan":
      return ".aiqt/inputs/plan.json";
    case "aiqt checkpoint":
      return ".aiqt/inputs/checkpoint.json";
    default:
      return null;
  }
}

function promptCommand(assessment: WorkflowAssessment): string | null {
  switch (assessment.recommendedCommand) {
    case "aiqt update":
      return "aiqt prompt update";
    case "aiqt plan":
      return "aiqt prompt plan --out .aiqt/inputs/plan.prompt.md";
    case "aiqt checkpoint":
      return "aiqt prompt checkpoint --out .aiqt/inputs/checkpoint.prompt.md";
    default:
      return null;
  }
}

/**
 * Deterministic guided-navigation adapter for aiqt start and aiqt continue.
 * The substantive command and reason are owned by assessWorkflow(); this
 * layer only supplies command-specific presentation fields.
 */
export function computeGuidance(ctx: GuidanceContext): GuidanceResultData {
  const assessment = assessWorkflow(ctx.project, ctx.state, {
    productionReady: ctx.productionReady ?? null,
  });
  const stage = stageForAssessment(assessment);
  const prompt = promptCommand(assessment);

  return {
    stage,
    guidance: assessment.recommendationReason,
    recommendedCommand: assessment.recommendedCommand,
    alternativeCommands: prompt ? [prompt] : [],
    promptCommand: prompt,
    expectedInputPath: expectedInputPath(assessment),
    followUpCommand:
      assessment.recommendedCommand === "aiqt checkpoint"
        ? "aiqt import checkpoint --stdin"
        : assessment.recommendedCommand === "aiqt review --mode release"
          ? "aiqt export all"
          : null,
    canProceedWithoutAgent:
      assessment.recommendedCommand === "aiqt checkpoint"
        ? ctx.checkpointInputExists
        : assessment.recommendedCommand !== null,
    planningMissingConditions: assessment.planningContext.missingConditions,
    planningUpdateInputPath: assessment.planningContext.ready ? null : ".aiqt/inputs/update.json",
  };
}
