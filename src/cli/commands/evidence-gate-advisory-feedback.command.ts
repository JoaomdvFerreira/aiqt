import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildEvidenceGateAdvisoryFeedbackRecordedEvent, readRunlogEventIds } from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import {
  AdvisoryFeedbackClassificationSchema,
  MAX_EVIDENCE_ADVISORY_FEEDBACK,
  type AdvisoryFeedbackClassification,
  type EvidenceAdvisoryFeedback,
} from "../../schema/evidence-advisory-feedback.schema.js";
import { getProjectIssues } from "../../services/project-issue-service.js";
import { isAdvisoryIssueKey } from "../../workflow/checkpoint-advisory-issues.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateAdvisoryFeedbackOptions {
  issueKey?: string;
  classification?: string;
  rationale?: string;
  preview?: boolean;
}

/**
 * @deprecated M33-WU05: this per-file wrapper now only delegates to the
 * shared familyFailureResult() (M33-WU02) -- prefer calling
 * familyFailureResult() directly in any new code. Retained here only to
 * avoid rewriting every existing call site in this file; not removed
 * because doing so would touch call sites with no behavioral benefit.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

function getFeedbackRecords(state: StateModel): EvidenceAdvisoryFeedback[] {
  return state.evidenceAdvisoryFeedback ?? [];
}

/**
 * aiqt evidence gate advisory feedback <issue-key> --classification <c>
 * --rationale <text> [--preview] [--json] (M29 §5.1): explicit, bounded,
 * non-semantic human classification of one advisory issue. Never touches
 * issue lifecycle, severity, readiness, checkpoint state, or enforcement.
 */
export function runEvidenceGateAdvisoryFeedback(
  ctx: CommandContext,
  options: RunEvidenceGateAdvisoryFeedbackOptions,
): CommandResult {
  try {
    const issueKey = (options.issueKey ?? "").trim();
    const rationale = (options.rationale ?? "").trim();
    if (issueKey === "" || options.classification === undefined || rationale === "") {
      return failure(
        "aiqt evidence gate advisory feedback <issue-key> requires --classification and --rationale.",
        ExitCode.HumanInputRequired,
        "EVIDENCE-GATE-ADVISORY-FEEDBACK-MISSING-INPUT",
      );
    }

    const classificationParse = AdvisoryFeedbackClassificationSchema.safeParse(options.classification);
    if (!classificationParse.success) {
      return failure(
        `--classification must be one of: ${AdvisoryFeedbackClassificationSchema.options.join(", ")}.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-ADVISORY-FEEDBACK-INVALID-CLASSIFICATION",
      );
    }
    const classification: AdvisoryFeedbackClassification = classificationParse.data;

    if (rationale.length > 2000) {
      return failure("--rationale must not exceed 2000 characters.", ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-FEEDBACK-RATIONALE-TOO-LONG");
    }

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-FEEDBACK-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    if (!isAdvisoryIssueKey(issueKey) || !getProjectIssues(state).some((pi) => pi.issueKey === issueKey)) {
      return failure(`"${issueKey}" is not an existing advisory issue.`, ExitCode.WorkflowBlocked, "EVIDENCE-GATE-ADVISORY-FEEDBACK-UNKNOWN-ISSUE");
    }

    const timestamp = new Date().toISOString();
    const existingRecords = getFeedbackRecords(state);
    const existing = existingRecords.find((f) => f.issueKey === issueKey);

    if (existing && existing.classification === classification && existing.rationale === rationale) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Feedback for ${issueKey} is already recorded as ${classification} (idempotent no-op).`,
        exitCode: ExitCode.Success,
        data: { issueKey, classification, outcome: "no_op" },
      });
    }

    if (!existing && existingRecords.length >= MAX_EVIDENCE_ADVISORY_FEEDBACK) {
      return failure(`Feedback cap reached (max_feedback=${MAX_EVIDENCE_ADVISORY_FEEDBACK}).`, ExitCode.WorkflowBlocked, "EVIDENCE-GATE-ADVISORY-FEEDBACK-CAP-REACHED");
    }

    const record: EvidenceAdvisoryFeedback = {
      issueKey,
      classification,
      rationale,
      recordedAt: existing?.recordedAt ?? timestamp,
      updatedAt: timestamp,
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would ${existing ? "update" : "record"} feedback for ${issueKey} as ${classification}; no state written.`,
        exitCode: ExitCode.Success,
        data: { issueKey, classification, outcome: "preview" },
      });
    }

    const finalState: StateModel = {
      ...state,
      evidenceAdvisoryFeedback: existing
        ? existingRecords.map((f) => (f.issueKey === issueKey ? record : f))
        : [...existingRecords, record],
    };
    writeStateModel(paths.stateFile, finalState);

    try {
      const eventIds = readRunlogEventIds(paths.runlogFile);
      const eventId = nextId("EVT", eventIds);
      appendRunlogEvent(
        paths.runlogFile,
        buildEvidenceGateAdvisoryFeedbackRecordedEvent({
          id: eventId,
          timestamp,
          relatedIds: [issueKey],
          data: { issueKey, classification, recordedAt: record.recordedAt, updatedAt: record.updatedAt },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying is idempotent.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-ADVISORY-FEEDBACK-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Feedback recorded for ${issueKey}: ${classification}.`,
      completedActions: ["Read project.json", "Read state.json", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [issueKey],
      exitCode: ExitCode.Success,
      data: { issueKey, classification, outcome: existing ? "updated" : "recorded" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-FEEDBACK-UNEXPECTED-ERROR");
  }
}
