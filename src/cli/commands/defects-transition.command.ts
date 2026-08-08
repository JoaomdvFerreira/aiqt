import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildDefectStatusChangedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { validateDefectTransition } from "../../workflow/defect-transitions.js";
import { DefectStatusSchema, type DefectRecord } from "../../schema/defect.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

export interface RunDefectsTransitionOptions {
  to?: string;
  reason?: string;
  preview?: boolean;
}

/**
 * aiqt defects transition <defectId> --to <status> --reason <text>
 * [--preview] [--json] (M42 §7/§9 WU42-03): the one explicit,
 * human-driven override surface for queueing/deferring/invalidating a
 * defect outside the automated triage disposition (e.g. marking an
 * explicit false positive `invalid`, dogfood scenario 7). Every
 * transition is still validated against the same DEFECT_TRANSITIONS
 * table triage uses -- this command grants no transition triage would
 * not also be allowed to make, it only lets a human drive it directly.
 */
export async function runDefectsTransition(
  ctx: CommandContext,
  defectId: string,
  options: RunDefectsTransitionOptions,
): Promise<CommandResult> {
  try {
    if (!options.to) {
      return failure("aiqt defects transition requires --to <status>.", ExitCode.HumanInputRequired, "DEFECTS-TRANSITION-NO-TARGET");
    }
    const targetParse = DefectStatusSchema.safeParse(options.to);
    if (!targetParse.success) {
      return failure(`Invalid --to "${options.to}".`, ExitCode.InvalidInput, "DEFECTS-TRANSITION-INVALID-TARGET");
    }
    if (!options.reason || options.reason.trim() === "") {
      return failure("aiqt defects transition requires --reason <text>.", ExitCode.HumanInputRequired, "DEFECTS-TRANSITION-NO-REASON");
    }

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-TRANSITION-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);
    const defects = state.defects ?? [];
    const defect = defects.find((d) => d.defectId === defectId);
    if (!defect) {
      return failure(`No defect "${defectId}" exists.`, ExitCode.InvalidInput, "DEFECTS-TRANSITION-UNKNOWN-DEFECT");
    }

    const check = validateDefectTransition(defect.status, targetParse.data);
    if (!check.ok) {
      return failure(check.reason ?? "Illegal transition.", ExitCode.WorkflowBlocked, "DEFECTS-TRANSITION-ILLEGAL");
    }

    const now = new Date().toISOString();
    const updated: DefectRecord = { ...defect, status: targetParse.data, updatedAt: now };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "defects",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: ${defectId} would transition ${defect.status} -> ${targetParse.data}; no state written.`,
        exitCode: ExitCode.Success,
        data: { defect: updated, outcome: "preview" },
      });
    }

    const finalState: StateModel = { ...state, defects: defects.map((d) => (d.defectId === defectId ? updated : d)) };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildDefectStatusChangedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [defectId],
          data: { defectId, fromStatus: defect.status, toStatus: targetParse.data, reason: options.reason },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "DEFECTS-TRANSITION-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "defects",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `${defectId}: ${defect.status} -> ${targetParse.data} (${options.reason}).`,
      completedActions: ["Validated transition", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [defectId],
      exitCode: ExitCode.Success,
      data: { defect: updated, outcome: "applied" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "DEFECTS-TRANSITION-UNEXPECTED-ERROR");
  }
}
