import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildExceptionRevokedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { getRequiredEvidenceExceptions } from "../../services/evidence-enforcement-service.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateExceptionRevokeOptions {
  exceptionId?: string;
  revokedBy?: string;
  reason?: string;
  preview?: boolean;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return makeResult({
    status: exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed",
    action: "evidence",
    summary,
    exitCode,
    blockingIssues: [{ id: issueId, severity: "high", area: "evidence-gate", message: summary, agentCanFix: false }],
  });
}

/**
 * aiqt evidence gate exception revoke <exception-id> --revoked-by --reason
 * [--preview] [--json] (M30 §5.4): append-only audited revocation. A
 * consumed or expired exception cannot be "un-revoked" and revoking an
 * already-revoked exception is an idempotent no-op.
 */
export async function runEvidenceGateExceptionRevoke(
  ctx: CommandContext,
  options: RunEvidenceGateExceptionRevokeOptions,
): Promise<CommandResult> {
  try {
    if (!options.exceptionId) {
      return failure("aiqt evidence gate exception revoke requires <exception-id>.", ExitCode.HumanInputRequired, "EXCEPTION-REVOKE-NO-ID");
    }
    if (!options.revokedBy || !options.reason) {
      return failure("aiqt evidence gate exception revoke requires --revoked-by and --reason.", ExitCode.HumanInputRequired, "EXCEPTION-REVOKE-MISSING-HUMAN-INPUT");
    }

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXCEPTION-REVOKE-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    const exceptions = getRequiredEvidenceExceptions(state);
    const exception = exceptions.find((e) => e.exceptionId === options.exceptionId);
    if (!exception) {
      return failure(`No exception "${options.exceptionId}" exists.`, ExitCode.InvalidInput, "EXCEPTION-REVOKE-UNKNOWN-EXCEPTION");
    }
    if (exception.status === "revoked") {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Exception "${options.exceptionId}" is already revoked (idempotent no-op).`,
        exitCode: ExitCode.Success,
        data: { exceptionId: options.exceptionId, outcome: "no_op" },
      });
    }
    if (exception.status === "consumed") {
      return failure(`Exception "${options.exceptionId}" has already been consumed and cannot be revoked.`, ExitCode.WorkflowBlocked, "EXCEPTION-REVOKE-ALREADY-CONSUMED");
    }

    const now = new Date().toISOString();

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would revoke exception ${options.exceptionId}; no state written.`,
        exitCode: ExitCode.Success,
        data: { exceptionId: options.exceptionId, outcome: "preview" },
      });
    }

    const finalState: StateModel = {
      ...state,
      requiredEvidenceExceptions: exceptions.map((e) => (e.exceptionId === options.exceptionId ? { ...e, status: "revoked" as const } : e)),
    };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildExceptionRevokedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [options.exceptionId],
          data: { exceptionId: options.exceptionId, revokedBy: options.revokedBy },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying is idempotent.`,
        ExitCode.InvalidInput,
        "EXCEPTION-REVOKE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Revoked exception ${options.exceptionId}.`,
      completedActions: ["Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [options.exceptionId],
      exitCode: ExitCode.Success,
      data: { exceptionId: options.exceptionId, outcome: "revoked" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EXCEPTION-REVOKE-UNEXPECTED-ERROR");
  }
}
