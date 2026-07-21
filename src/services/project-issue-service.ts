import type { StateModel } from "../schema/state.schema.js";
import type { ProjectIssue, ProjectIssueTransition } from "../schema/project-issue.schema.js";

/** M22-WU02: missing state.issues.projectIssues must be treated as an empty array. */
export function getProjectIssues(state: StateModel): ProjectIssue[] {
  return state.issues?.projectIssues ?? [];
}

/** M22-WU02: missing state.issues.projectIssueTransitions must be treated as an empty array. */
export function getProjectIssueTransitions(state: StateModel): ProjectIssueTransition[] {
  return state.issues?.projectIssueTransitions ?? [];
}

/** Look up a ProjectIssue by its canonical, deterministic issueKey. */
export function findProjectIssueByKey(
  issueKey: string,
  projectIssues: readonly ProjectIssue[],
): ProjectIssue | undefined {
  return projectIssues.find((pi) => pi.issueKey === issueKey);
}
