import type { CheckpointAdvisoryObservation } from "../schema/checkpoint-evidence-advisory.schema.js";

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
