import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildDefectStatusChangedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { applyTriage } from "../../services/defect-triage-service.js";
import type { StateModel } from "../../schema/state.schema.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

export interface RunDefectsTriageOptions {
  preview?: boolean;
}

/**
 * aiqt defects triage <defectId> [--preview] [--json] (M42 §6/§9 WU42-03):
 * runs the deterministic triage decision and applies the resulting status
 * transition(s). Discovery alone never reaches this -- triage is always a
 * separate, explicit step (Section 2's core invariant).
 */
export async function runDefectsTriage(
  ctx: CommandContext,
  defectId: string,
  options: RunDefectsTriageOptions,
): Promise<CommandResult> {
  try {
    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-TRIAGE-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);
    const now = new Date().toISOString();
    const outcome = applyTriage(state, defectId, now);

    if (!outcome.ok) {
      const isUnknown = outcome.reason.startsWith("No defect");
      return failure(outcome.reason, ExitCode.InvalidInput, isUnknown ? "DEFECTS-TRIAGE-UNKNOWN-DEFECT" : "DEFECTS-TRIAGE-NOT-TRIAGEABLE");
    }

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "defects",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: ${defectId} would become "${outcome.defect.status}" (${outcome.defect.triage?.queueDisposition}); no state written.`,
        exitCode: ExitCode.Success,
        data: { defect: outcome.defect, transitions: outcome.transitions, outcome: "preview" },
      });
    }

    const existingDefects = state.defects ?? [];
    const nextDefects = existingDefects.map((d) => (d.defectId === defectId ? outcome.defect : d));
    const finalState: StateModel = { ...state, defects: nextDefects };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      for (const t of outcome.transitions) {
        appendRunlogEvent(
          paths.runlogFile,
          buildDefectStatusChangedEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [defectId],
            data: { defectId, fromStatus: t.from, toStatus: t.to, reason: "triage" },
          }),
        );
      }
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "DEFECTS-TRIAGE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "defects",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Triaged ${defectId}: ${outcome.transitions.map((t) => `${t.from}->${t.to}`).join(", ") || "(no status change)"}. Disposition: ${outcome.defect.triage?.queueDisposition}.`,
      completedActions: ["Computed deterministic triage decision", "Applied validated status transition(s)", "Wrote state.json", "Appended runlog event(s)"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [defectId],
      exitCode: ExitCode.Success,
      data: { defect: outcome.defect, transitions: outcome.transitions, outcome: "applied" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "DEFECTS-TRIAGE-UNEXPECTED-ERROR");
  }
}
