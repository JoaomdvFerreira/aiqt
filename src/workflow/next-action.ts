import type { Issue } from "../core/output/issue.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import { isPlanningContextReady } from "./planning-readiness.js";

export interface NextActionResult {
  /** The recommended next CLI command, or null if blocked. */
  nextRecommendedCommand: string | null;
  /** Human-readable reason for the recommendation. */
  reason: string;
  blockingIssues: Issue[];
  warnings: Issue[];
}

function hasWorkGraph(state: StateModel): boolean {
  return state.workGraph.milestones.length > 0;
}

/**
 * Compute the next required workflow action given a validated project and
 * state. Assumes .aiqt/ was located and both files are valid; the missing
 * .aiqt/ case is handled by the command layer before this is called.
 *
 * Uses the deterministic planning-readiness rule (Milestone 2) rather than a
 * loose "has any context" heuristic, so the recommendation between
 * `aiqt update` and `aiqt plan` is precise and reproducible.
 */
export function computeNextAction(
  project: ProjectModel,
  state: StateModel,
): NextActionResult {
  if (!hasWorkGraph(state)) {
    if (isPlanningContextReady(project)) {
      return {
        nextRecommendedCommand: "aiqt plan",
        reason:
          "Project context is sufficient and no work graph exists yet. Run aiqt plan to generate the work graph.",
        blockingIssues: [],
        warnings: [],
      };
    }

    return {
      nextRecommendedCommand: "aiqt update",
      reason:
        "Project context is incomplete. Run aiqt update to capture project context.",
      blockingIssues: [],
      warnings: [],
    };
  }

  const hasReadyWorkUnit = state.workGraph.workUnits.some(
    (wu) => wu.status === "ready",
  );

  if (hasReadyWorkUnit) {
    return {
      nextRecommendedCommand: "aiqt next",
      reason:
        "A work graph exists with at least one ready work unit. Run aiqt next to receive the next work unit.",
      blockingIssues: [],
      warnings: [],
    };
  }

  return {
    nextRecommendedCommand: null,
    reason:
      "A work graph exists, but no work unit is currently ready and full aiqt next (agent packet generation) arrives in a later milestone.",
    blockingIssues: [],
    warnings: [
      {
        id: "NEXT-NOT-IMPLEMENTED",
        severity: "low",
        area: "workflow",
        message:
          "Full aiqt next behavior (agent packet generation) is not implemented yet.",
        suggestedAction: "Await a later AIQT milestone.",
        agentCanFix: false,
      },
    ],
  };
}
