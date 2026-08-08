import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildDefectStatusChangedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { nextId } from "../../state/ids.js";
import { prepareRemediation } from "../../services/defect-remediation-service.js";
import type { StateModel } from "../../schema/state.schema.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

export interface RunDefectsRemediateOptions {
  objective?: string;
  scope?: string;
  outOfScope?: string;
  acceptance?: string;
  approvedBy?: string;
  preview?: boolean;
}

/**
 * aiqt defects remediate <defectId> --objective --scope --acceptance
 * [--out-of-scope] [--approved-by] [--preview] [--json] (M42 §8/§9
 * WU42-04): builds a bounded remediation request and, when eligible,
 * moves the defect queued -> in_progress. No execution occurs here --
 * this command performs no process spawn, sandbox call, or filesystem
 * mutation beyond the defect record; it is the bounded external-agent
 * handoff/request Section 8 requires when no live controlled-execution
 * path is wired into this call. Remediation risk >=50 requires
 * --approved-by; without it nothing is persisted (exit HumanInputRequired).
 */
export async function runDefectsRemediate(
  ctx: CommandContext,
  defectId: string,
  options: RunDefectsRemediateOptions,
): Promise<CommandResult> {
  try {
    if (!options.objective || !options.scope || !options.acceptance) {
      return failure("aiqt defects remediate requires --objective, --scope, and --acceptance.", ExitCode.HumanInputRequired, "DEFECTS-REMEDIATE-MISSING-INPUT");
    }
    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-REMEDIATE-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);
    const defects = state.defects ?? [];
    const defect = defects.find((d) => d.defectId === defectId);
    if (!defect) {
      return failure(`No defect "${defectId}" exists.`, ExitCode.InvalidInput, "DEFECTS-REMEDIATE-UNKNOWN-DEFECT");
    }

    const now = new Date().toISOString();
    const remediationId = nextId(
      "REM",
      defects.filter((d) => d.remediation).map((d) => d.remediation!.remediationId),
    );
    const scope = options.scope.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const outOfScope = (options.outOfScope ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);

    const outcome = prepareRemediation({
      defect,
      remediationId,
      objective: options.objective,
      scope,
      outOfScope,
      acceptanceContract: options.acceptance,
      approvedBy: options.approvedBy,
      now,
    });

    if (!outcome.ok) {
      return failure(
        outcome.reason,
        outcome.requiresHumanApproval ? ExitCode.HumanInputRequired : ExitCode.InvalidInput,
        outcome.requiresHumanApproval ? "DEFECTS-REMEDIATE-RISK-REQUIRES-APPROVAL" : "DEFECTS-REMEDIATE-NOT-ELIGIBLE",
      );
    }

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "defects",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: ${defectId} would start remediation ${remediationId} (risk ${outcome.remediation.remediationRiskScore}/100, ${outcome.remediation.remediationRiskBand}); no state written.`,
        exitCode: ExitCode.Success,
        data: { defect: outcome.defect, remediation: outcome.remediation, outcome: "preview" },
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
          relatedIds: [defectId, remediationId],
          data: { defectId, fromStatus: "queued", toStatus: "in_progress", reason: `remediation ${remediationId} started` },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "DEFECTS-REMEDIATE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "defects",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Started remediation ${remediationId} for ${defectId} (risk ${outcome.remediation.remediationRiskScore}/100, ${outcome.remediation.remediationRiskBand}).`,
      completedActions: ["Computed remediation risk", "Validated queued -> in_progress transition", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [defectId, remediationId],
      exitCode: ExitCode.Success,
      data: { defect: outcome.defect, remediation: outcome.remediation, outcome: "applied" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "DEFECTS-REMEDIATE-UNEXPECTED-ERROR");
  }
}
