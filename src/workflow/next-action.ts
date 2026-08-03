import type { Issue } from "../core/output/issue.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import { assessWorkflow } from "./workflow-assessment.js";

export interface NextActionResult {
  /** The recommended next CLI command, or null if blocked. */
  nextRecommendedCommand: string | null;
  /** Human-readable reason for the recommendation. */
  reason: string;
  blockingIssues: Issue[];
  warnings: Issue[];
}

/**
 * Compatibility adapter for legacy callers. The substantive workflow
 * recommendation is owned by assessWorkflow().
 */
export function computeNextAction(
  project: ProjectModel,
  state: StateModel,
): NextActionResult {
  const assessment = assessWorkflow(project, state);
  return {
    nextRecommendedCommand: assessment.recommendedCommand,
    reason: assessment.recommendationReason,
    blockingIssues: assessment.integrityStatus === "invalid" ? assessment.findings : [],
    warnings: [],
  };
}
