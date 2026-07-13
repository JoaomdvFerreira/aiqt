import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";
import { isPlanningContextReady } from "./planning-readiness.js";

/**
 * The single authoritative nextRecommendedCommand precedence for aiqt
 * review (§17.1), reused as-is by aiqt export for its own workflow-state
 * recommendation (§17.2). Priority 1 ("canonical state cannot be read") is
 * handled by the caller before this function is ever invoked.
 */
export function computeReviewNextCommand(
  project: ProjectModel,
  state: StateModel,
  findings: readonly ReviewFinding[],
): string {
  // 2. Any blocking review finding exists.
  if (findings.some((f) => f.blocking)) {
    return "aiqt review";
  }

  const workUnits = state.workGraph.workUnits;

  // 3. currentWorkUnitId is non-null and references an in_progress work unit.
  if (state.currentWorkUnitId !== null) {
    const current = workUnits.find((wu) => wu.id === state.currentWorkUnitId);
    if (current?.status === "in_progress") {
      return "aiqt checkpoint";
    }
  }

  // 4. Any work unit has status needs_review.
  if (workUnits.some((wu) => wu.status === "needs_review")) {
    return "aiqt review";
  }

  const hasWorkGraph = state.workGraph.milestones.length > 0;

  // 5/6. workGraph is empty.
  if (!hasWorkGraph) {
    return isPlanningContextReady(project) ? "aiqt plan" : "aiqt update";
  }

  // 7. At least one ready work unit exists and no current work is active.
  if (workUnits.some((wu) => wu.status === "ready") && state.currentWorkUnitId === null) {
    return "aiqt next";
  }

  // 8. All work units are done and no blocking review finding exists.
  // RC1: canonical all-done recommendation is "aiqt export all" (the full
  // generated document set), matching aiqt start/continue's guidance so the
  // CLI never disagrees with itself at this workflow state.
  if (workUnits.length > 0 && workUnits.every((wu) => wu.status === "done")) {
    return "aiqt export all";
  }

  // 9. No immediate workflow action can be determined.
  return "aiqt review";
}
