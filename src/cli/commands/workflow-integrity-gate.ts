import { makeResult, type CommandResult, type WorkflowAction } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { WorkflowAssessment } from "../../workflow/workflow-assessment.js";

export function buildWorkflowIntegrityBlockedResult(
  action: WorkflowAction,
  state: StateModel,
  assessment: WorkflowAssessment,
): CommandResult {
  return makeResult({
    status: "blocked",
    action,
    projectStatus: assessment.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: assessment.recommendationReason,
    nextRecommendedCommand: assessment.recommendedCommand,
    exitCode: ExitCode.WorkflowBlocked,
    blockingIssues: assessment.findings,
  });
}
