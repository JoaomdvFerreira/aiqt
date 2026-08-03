import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import { assessWorkflow, type WorkflowAssessmentOptions } from "../workflow/workflow-assessment.js";

export function applyWorkflowAssessmentToState(
  project: ProjectModel,
  state: StateModel,
  options: WorkflowAssessmentOptions = {},
): StateModel {
  const assessment = assessWorkflow(project, state, options);
  return {
    ...state,
    projectStatus: assessment.projectStatus,
    nextRecommendedCommand: assessment.recommendedCommand,
  };
}
