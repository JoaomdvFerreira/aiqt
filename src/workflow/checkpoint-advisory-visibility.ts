import type { CheckpointAdvisoryObservation } from "../schema/checkpoint-evidence-advisory.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import { getProjectIssues, resolveEffectiveProjectIssueLifecycle } from "../services/project-issue-service.js";
import { getIssueOverrides, getIssuePromotions } from "../services/issue-service.js";
import { isAdvisoryIssueKey } from "./checkpoint-advisory-issues.js";

/**
 * M29 §6: "Use one centralized advisory projection." Checkpoint, status,
 * review, manage, and export all render this same bounded shape rather
 * than each re-deriving refreshCommand/configurationCommand presence
 * independently.
 */
export interface EvidenceAdvisorySummary {
  status: "evaluated" | "not_configured" | "unavailable";
  result: "pass" | "fail" | "indeterminate" | null;
  issueCount: number;
  blocking: false;
  refreshCommand?: string;
  configurationCommand?: string;
}

/**
 * M29 §6 command-presence rules: refreshCommand only for
 * unavailable/fail/indeterminate; absent for pass/not_configured.
 * configurationCommand only for not_configured. Never executed
 * automatically -- bounded deterministic guidance strings only.
 */
export function buildEvidenceAdvisorySummary(
  observation: CheckpointAdvisoryObservation,
  checkpointId: string,
): EvidenceAdvisorySummary {
  const summary: EvidenceAdvisorySummary = {
    status: observation.evaluationStatus,
    result: observation.overallResult,
    issueCount: observation.issueKeys.length,
    blocking: false,
  };

  const needsRefresh =
    observation.evaluationStatus === "unavailable" ||
    observation.overallResult === "fail" ||
    observation.overallResult === "indeterminate";
  if (needsRefresh) {
    summary.refreshCommand = `aiqt evidence gate advisory refresh --checkpoint ${checkpointId}`;
  }

  if (observation.evaluationStatus === "not_configured") {
    summary.configurationCommand = "aiqt evidence gate policy import --from-file <path>";
  }

  return summary;
}

export interface AdvisoryWarning {
  issueKey: string;
  title: string;
  severity: string;
  checkpointId: string | null;
  status: string;
}

/**
 * M29 §6: "Show advisory warnings in a separate non-blocking section."
 * Only currently-active (not overridden/resolved) advisory-sourced
 * ProjectIssues are surfaced -- reuses the existing M22 override/promotion
 * lifecycle resolver directly, never a second classifier.
 */
export function buildAdvisoryWarningsSection(state: StateModel): AdvisoryWarning[] {
  const overrides = getIssueOverrides(state);
  const promotions = getIssuePromotions(state);
  return getProjectIssues(state)
    .filter((issue) => isAdvisoryIssueKey(issue.issueKey))
    .map((issue) => ({
      issueKey: issue.issueKey,
      title: issue.title,
      severity: issue.severity,
      checkpointId: issue.checkpointRefs[0] ?? null,
      status: resolveEffectiveProjectIssueLifecycle(issue.issueKey, overrides, promotions),
    }))
    .filter((w) => w.status === "active");
}
