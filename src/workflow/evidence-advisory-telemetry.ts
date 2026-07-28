import type { StateModel } from "../schema/state.schema.js";
import { readRunlogEvents } from "../state/runlog-store.js";
import { getProjectIssues } from "../services/project-issue-service.js";
import { isAdvisoryIssueKey } from "./checkpoint-advisory-issues.js";

export interface EvidenceAdvisoryFeedbackTelemetry {
  confirmed: number;
  falsePositive: number;
  policyGap: number;
  evidenceMissing: number;
  unclassified: number;
}

export interface EvidenceAdvisoryTelemetry {
  evaluatedCheckpoints: number;
  pass: number;
  fail: number;
  indeterminate: number;
  unavailable: number;
  notConfigured: number;
  checkpointsCompletedDespiteFail: number;
  checkpointsCompletedDespiteIndeterminate: number;
  refreshedAfterAmendment: number;
  feedback: EvidenceAdvisoryFeedbackTelemetry;
  historyComplete: boolean;
  runlogGapCount: number;
}

interface ObservationEventData {
  observationId?: unknown;
  checkpointId?: unknown;
  trigger?: unknown;
  evaluationStatus?: unknown;
  overallResult?: unknown;
}

interface FeedbackEventData {
  issueKey?: unknown;
  classification?: unknown;
}

/**
 * M29 §5.2: "current checkpoint status derives from canonical checkpoint
 * state; lifetime and cross-refresh counts derive from
 * evidence_gate.advisory_observation_recorded; feedback counts derive from
 * evidence_gate.advisory_feedback_recorded." The runlog is scanned as the
 * complete historical authority; canonical state is used only to detect
 * gaps (an observation/feedback the state successfully persisted that the
 * runlog is missing -- M29 §3.1/§7.2's documented failure mode).
 */
export function computeEvidenceAdvisoryTelemetry(state: StateModel, runlogPath: string): EvidenceAdvisoryTelemetry {
  const events = readRunlogEvents(runlogPath);

  const observationEvents = events.filter((e) => e.type === "evidence_gate.advisory_observation_recorded");
  const feedbackEvents = events.filter((e) => e.type === "evidence_gate.advisory_feedback_recorded");

  const evaluatedCheckpointIds = new Set<string>();
  let pass = 0;
  let fail = 0;
  let indeterminate = 0;
  let unavailable = 0;
  let notConfigured = 0;
  let refreshedAfterAmendment = 0;
  const runlogObservationIds = new Set<string>();

  for (const event of observationEvents) {
    const data = (event.data ?? {}) as ObservationEventData;
    if (typeof data.observationId === "string") runlogObservationIds.add(data.observationId);
    if (typeof data.checkpointId === "string") evaluatedCheckpointIds.add(data.checkpointId);
    if (data.trigger === "amendment") refreshedAfterAmendment += 1;

    switch (data.evaluationStatus) {
      case "unavailable":
        unavailable += 1;
        break;
      case "not_configured":
        notConfigured += 1;
        break;
      case "evaluated":
        if (data.overallResult === "pass") pass += 1;
        else if (data.overallResult === "fail") fail += 1;
        else if (data.overallResult === "indeterminate") indeterminate += 1;
        break;
      default:
        break;
    }
  }

  // M29 §5.2: distinct issues, keyed by their most recent feedback event.
  // A Map naturally collapses duplicate/replayed events for the same
  // issueKey to their last (i.e. current) classification, so identical
  // replay and duplicate runlog events never double-count.
  const latestFeedbackByIssue = new Map<string, string>();
  const runlogFeedbackKeys = new Set<string>();
  for (const event of feedbackEvents) {
    const data = (event.data ?? {}) as FeedbackEventData;
    if (typeof data.issueKey !== "string" || typeof data.classification !== "string") continue;
    latestFeedbackByIssue.set(data.issueKey, data.classification);
    runlogFeedbackKeys.add(data.issueKey);
  }

  // Gate J correction: `unclassified` must be "distinct M29 advisory issue
  // keys minus distinct M29 advisory issue keys with current feedback" --
  // not (as before) a dead branch on an already-valid classification enum.
  // Reuses the existing M22 ProjectIssue owner and the M29 advisory-key
  // predicate; no second issue/telemetry store is introduced.
  const advisoryIssueKeys = new Set(
    getProjectIssues(state)
      .map((issue) => issue.issueKey)
      .filter((issueKey) => isAdvisoryIssueKey(issueKey)),
  );

  const feedback: EvidenceAdvisoryFeedbackTelemetry = {
    confirmed: 0,
    falsePositive: 0,
    policyGap: 0,
    evidenceMissing: 0,
    unclassified: 0,
  };
  let classifiedAdvisoryIssueCount = 0;
  for (const [issueKey, classification] of latestFeedbackByIssue) {
    if (!advisoryIssueKeys.has(issueKey)) continue;
    classifiedAdvisoryIssueCount += 1;
    if (classification === "confirmed") feedback.confirmed += 1;
    else if (classification === "false_positive") feedback.falsePositive += 1;
    else if (classification === "policy_gap") feedback.policyGap += 1;
    else if (classification === "evidence_missing") feedback.evidenceMissing += 1;
  }
  feedback.unclassified = advisoryIssueKeys.size - classifiedAdvisoryIssueCount;

  // Checkpoints completed despite an advisory fail/indeterminate: derived
  // from canonical checkpoint state (current status), since that reflects
  // whether the checkpoint itself is still "done"/"needs_review" today.
  let checkpointsCompletedDespiteFail = 0;
  let checkpointsCompletedDespiteIndeterminate = 0;
  const stateObservationIds = new Set<string>();
  for (const advisory of state.checkpointEvidenceAdvisories ?? []) {
    for (const observation of advisory.history) {
      stateObservationIds.add(observation.observationId);
    }
    if (advisory.current.overallResult === "fail") checkpointsCompletedDespiteFail += 1;
    else if (advisory.current.overallResult === "indeterminate") checkpointsCompletedDespiteIndeterminate += 1;
  }

  let runlogGapCount = 0;
  for (const observationId of stateObservationIds) {
    if (!runlogObservationIds.has(observationId)) runlogGapCount += 1;
  }
  for (const feedbackRecord of state.evidenceAdvisoryFeedback ?? []) {
    if (!runlogFeedbackKeys.has(feedbackRecord.issueKey)) runlogGapCount += 1;
  }

  return {
    evaluatedCheckpoints: evaluatedCheckpointIds.size,
    pass,
    fail,
    indeterminate,
    unavailable,
    notConfigured,
    checkpointsCompletedDespiteFail,
    checkpointsCompletedDespiteIndeterminate,
    refreshedAfterAmendment,
    feedback,
    historyComplete: runlogGapCount === 0,
    runlogGapCount,
  };
}
