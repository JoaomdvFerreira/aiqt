import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildRequiredModeDeactivatedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { getRequiredModeActivations } from "../../services/evidence-enforcement-service.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateEnforcementActivationDeactivateOptions {
  activationId?: string;
  deactivatedBy?: string;
  reason?: string;
  confirmDeactivate?: string;
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

/**
 * aiqt evidence gate enforcement activation deactivate --activation
 * --deactivated-by --reason --confirm-deactivate <project-id> [--json]
 * (M30 §5.3): returns the project to advisory/off. Never completes or
 * amends any Work Unit, never deletes decisions/issues/exceptions/history
 * -- only the activation's own status changes.
 */
export async function runEvidenceGateEnforcementActivationDeactivate(
  ctx: CommandContext,
  options: RunEvidenceGateEnforcementActivationDeactivateOptions,
): Promise<CommandResult> {
  try {
    if (!options.activationId) {
      return failure("aiqt evidence gate enforcement activation deactivate requires --activation <activation-id>.", ExitCode.HumanInputRequired, "ACTIVATION-DEACTIVATE-NO-ACTIVATION");
    }
    if (!options.deactivatedBy || !options.reason || !options.confirmDeactivate) {
      return failure("aiqt evidence gate enforcement activation deactivate requires --deactivated-by, --reason, and --confirm-deactivate <project-id>.", ExitCode.HumanInputRequired, "ACTIVATION-DEACTIVATE-MISSING-HUMAN-INPUT");
    }

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ACTIVATION-DEACTIVATE-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    if (options.confirmDeactivate !== project.project.id) {
      return failure(`--confirm-deactivate must exactly match the current project id ("${project.project.id}").`, ExitCode.InvalidInput, "ACTIVATION-DEACTIVATE-CONFIRMATION-MISMATCH");
    }

    const activations = getRequiredModeActivations(state);
    const activation = activations.find((a) => a.activationId === options.activationId);
    if (!activation) {
      return failure(`No activation "${options.activationId}" exists.`, ExitCode.InvalidInput, "ACTIVATION-DEACTIVATE-UNKNOWN-ACTIVATION");
    }
    if (activation.status !== "active") {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Activation "${options.activationId}" is already deactivated (idempotent no-op).`,
        exitCode: ExitCode.Success,
        data: { activationId: options.activationId, outcome: "no_op" },
      });
    }

    const now = new Date().toISOString();
    const updatedActivation = { ...activation, status: "deactivated" as const, deactivatedAt: now, deactivatedBy: options.deactivatedBy, deactivationReason: options.reason };

    const finalState: StateModel = {
      ...state,
      requiredModeActivations: activations.map((a) => (a.activationId === activation.activationId ? updatedActivation : a)),
    };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildRequiredModeDeactivatedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [activation.activationId, project.project.id],
          data: { activationId: activation.activationId, deactivatedBy: options.deactivatedBy },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying is idempotent.`,
        ExitCode.InvalidInput,
        "ACTIVATION-DEACTIVATE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Required mode deactivated: ${activation.activationId}. Project returns to advisory/off.`,
      completedActions: ["Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [activation.activationId],
      exitCode: ExitCode.Success,
      data: { activation: updatedActivation, outcome: "deactivated" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "ACTIVATION-DEACTIVATE-UNEXPECTED-ERROR");
  }
}
