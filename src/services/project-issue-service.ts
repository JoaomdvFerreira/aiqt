import type { StateModel } from "../schema/state.schema.js";
import type { ProjectIssue, ProjectIssueTransition } from "../schema/project-issue.schema.js";
import type { IssueOverride, IssueOverrideStatus, IssuePromotion } from "../schema/issue-state.schema.js";
import { effectiveIssueStatus, findIssuePromotion } from "./issue-service.js";

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

/**
 * M22 §5.5.1/§6.5: ProjectIssue persists no mutable lifecycle status of its
 * own. Effective lifecycle is derived, on demand, from the existing
 * centralized IssueOverride/IssuePromotion services (reused here, never
 * reimplemented) keyed by the same canonical `issueKey` a CheckpointIssue
 * would use. This is the one shared resolver every ProjectIssue consumer
 * must use -- promotion takes precedence over an override, since a
 * promoted issue's repair work unit is the authoritative next action
 * regardless of any earlier accept/defer/resolve override.
 */
export type EffectiveProjectIssueLifecycle = IssueOverrideStatus | "promoted";

export function resolveEffectiveProjectIssueLifecycle(
  issueKey: string,
  overrides: readonly IssueOverride[],
  promotions: readonly IssuePromotion[],
): EffectiveProjectIssueLifecycle {
  if (findIssuePromotion(issueKey, promotions)) return "promoted";
  return effectiveIssueStatus(issueKey, overrides);
}
