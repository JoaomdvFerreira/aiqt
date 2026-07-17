import type { Issue } from "../core/output/issue.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import { isPlanningContextReady } from "./planning-readiness.js";
import { computeEffectiveReadinessForState } from "./effective-readiness.js";

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

  // M18 §9: recommend "aiqt next" only when an effectively ready work unit
  // exists -- a canonically "ready" but stale (dependency-blocked) unit
  // would only be rejected by aiqt next, so it must not drive this
  // recommendation.
  const readiness = computeEffectiveReadinessForState(state);
  const hasEffectivelyReadyWorkUnit = [...readiness.values()].some((r) => r.effectivelyReady);

  if (hasEffectivelyReadyWorkUnit) {
    return {
      nextRecommendedCommand: "aiqt next",
      reason:
        "A work graph exists with at least one ready work unit. Run aiqt next to receive the next work unit.",
      blockingIssues: [],
      warnings: [],
    };
  }

  if (
    state.workGraph.workUnits.length > 0 &&
    state.workGraph.workUnits.every((wu) => wu.status === "done")
  ) {
    return {
      nextRecommendedCommand: "aiqt manage",
      reason: "All work units are done. Project is in review state. Run aiqt manage or aiqt export all.",
      blockingIssues: [],
      warnings: [],
    };
  }

  return {
    nextRecommendedCommand: state.currentWorkUnitId ? "aiqt checkpoint" : "aiqt review",
    reason: state.currentWorkUnitId
      ? "A work unit is in progress. Run aiqt checkpoint to capture its result."
      : "No ready work unit is currently available. Run aiqt review to see current findings.",
    blockingIssues: [],
    warnings: [],
  };
}
