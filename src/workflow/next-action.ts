import type { Issue } from "../core/output/issue.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";

export interface NextActionResult {
  /** The recommended next CLI command, or null if blocked. */
  nextRecommendedCommand: string | null;
  /** Human-readable reason for the recommendation. */
  reason: string;
  blockingIssues: Issue[];
  warnings: Issue[];
}

/** Whether the project has enough captured context to move past `draft`. */
function hasContext(project: ProjectModel): boolean {
  if (project.project.objective.trim() !== "") return true;
  if (project.requirements.length > 0) return true;
  if (project.context.constraints.length > 0) return true;
  if (project.context.businessRules.length > 0) return true;
  return false;
}

function hasWorkGraph(state: StateModel): boolean {
  return state.workGraph.milestones.length > 0;
}

/**
 * Compute the next required workflow action given a validated project and
 * state. Assumes .aiqt/ was located and both files are valid; the missing
 * .aiqt/ case is handled by the command layer before this is called.
 */
export function computeNextAction(
  project: ProjectModel,
  state: StateModel,
): NextActionResult {
  if (state.projectStatus === "draft" && !hasContext(project)) {
    return {
      nextRecommendedCommand: "aiqt update",
      reason:
        "Project is in draft and its context is incomplete. Run aiqt update to capture project context.",
      blockingIssues: [],
      warnings: [],
    };
  }

  if (!hasWorkGraph(state)) {
    return {
      nextRecommendedCommand: "aiqt plan",
      reason:
        "Project context is present but no work graph exists yet. Run aiqt plan to generate the work graph.",
      blockingIssues: [],
      warnings: [],
    };
  }

  return {
    nextRecommendedCommand: null,
    reason:
      "A work graph exists, but full aiqt next (agent packet generation) arrives in a later milestone.",
    blockingIssues: [],
    warnings: [
      {
        id: "NEXT-NOT-IMPLEMENTED",
        severity: "low",
        area: "workflow",
        message:
          "Full aiqt next behavior (agent packet generation) is not implemented in Milestone 1.",
        suggestedAction: "Await a later AIQT milestone.",
        agentCanFix: false,
      },
    ],
  };
}
