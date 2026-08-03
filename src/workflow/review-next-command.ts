import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";
import { assessWorkflow } from "./workflow-assessment.js";

/**
 * Compatibility adapter for callers that still expect a string command from
 * review. Release readiness remains classified by review/manage; the workflow
 * command choice is delegated to assessWorkflow().
 */
export function computeReviewNextCommand(
  project: ProjectModel,
  state: StateModel,
  findings: readonly ReviewFinding[],
): string {
  const allWorkDone =
    state.workGraph.workUnits.length > 0 &&
    state.workGraph.workUnits.every((wu) => wu.status === "done");
  const productionReady = allWorkDone ? !findings.some((f) => f.blocking) : null;
  return assessWorkflow(project, state, { productionReady }).recommendedCommand ?? "aiqt review";
}
