import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildDefectStatusChangedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { recordRemediationValidation } from "../../services/defect-remediation-service.js";
import type { StateModel } from "../../schema/state.schema.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

export interface RunDefectsRecordValidationOptions {
  outcome?: string;
  evidence?: string;
  note?: string;
  preview?: boolean;
}

/**
 * aiqt defects record-validation <defectId> --outcome <passed|failed>
 * --evidence <locator> [--note] [--preview] [--json] (M42 §3.6/§9
 * WU42-04): validation evidence, never agent assertion, controls
 * resolution. "passed" resolves the defect with bound evidence; "failed"
 * returns it to the queue with the failure evidence preserved -- never
 * silently closed (dogfood scenarios 11/12).
 */
export async function runDefectsRecordValidation(
  ctx: CommandContext,
  defectId: string,
  options: RunDefectsRecordValidationOptions,
): Promise<CommandResult> {
  try {
    if (options.outcome !== "passed" && options.outcome !== "failed") {
      return failure('aiqt defects record-validation requires --outcome "passed" or "failed".', ExitCode.HumanInputRequired, "DEFECTS-RECORD-VALIDATION-INVALID-OUTCOME");
    }
    if (!options.evidence) {
      return failure("aiqt defects record-validation requires --evidence <locator>.", ExitCode.HumanInputRequired, "DEFECTS-RECORD-VALIDATION-NO-EVIDENCE");
    }
    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-RECORD-VALIDATION-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);
    const defects = state.defects ?? [];
    const defect = defects.find((d) => d.defectId === defectId);
    if (!defect) {
      return failure(`No defect "${defectId}" exists.`, ExitCode.InvalidInput, "DEFECTS-RECORD-VALIDATION-UNKNOWN-DEFECT");
    }

    const now = new Date().toISOString();
    const outcome = recordRemediationValidation({
      defect,
      outcome: options.outcome,
      evidenceLocator: options.evidence,
      note: options.note,
      now,
    });

    if (!outcome.ok) {
      return failure(outcome.reason, ExitCode.InvalidInput, "DEFECTS-RECORD-VALIDATION-NOT-ELIGIBLE");
    }

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "defects",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: ${defectId} would transition ${outcome.transition.from} -> ${outcome.transition.to}; no state written.`,
        exitCode: ExitCode.Success,
        data: { defect: outcome.defect, transition: outcome.transition, outcome: "preview" },
      });
    }

    const finalState: StateModel = { ...state, defects: defects.map((d) => (d.defectId === defectId ? outcome.defect : d)) };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildDefectStatusChangedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [defectId],
          data: { defectId, fromStatus: outcome.transition.from, toStatus: outcome.transition.to, reason: `validation ${options.outcome}` },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "DEFECTS-RECORD-VALIDATION-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "defects",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `${defectId}: validation ${options.outcome} -- ${outcome.transition.from} -> ${outcome.transition.to}.`,
      completedActions: ["Recorded validation evidence", "Applied validated status transition", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [defectId],
      exitCode: ExitCode.Success,
      data: { defect: outcome.defect, transition: outcome.transition, outcome: "applied" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "DEFECTS-RECORD-VALIDATION-UNEXPECTED-ERROR");
  }
}
