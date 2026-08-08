import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { maintenanceFailure } from "./maintenance-shared.js";
import { runDueMaintenanceOccurrence, cancelMaintenanceOccurrence } from "../../services/maintenance-run-service.js";
import type { MaintenanceOccurrenceResultStatus } from "../../schema/maintenance-schedule.schema.js";

/**
 * `aiqt maintenance run-due` / `aiqt maintenance cancel <occurrenceId>`
 * (M45-WU03/WU04, build spec Sec 8, 13, 16): executes at most one due
 * occurrence through typed dispatch (maintenance-run-service.ts), or
 * cancels/reconciles the current active occurrence. Reuses the current
 * CLI machine contract's exit-code semantics -- "no schedule due" is a
 * normal, zero-mutation success (exit 0), a busy project is
 * WorkflowBlocked (exit 2), and an occurrence's own result status maps
 * through unchanged (never flattened into a generic scheduler error).
 */

const RESULT_STATUS_EXIT: Record<MaintenanceOccurrenceResultStatus, { status: "passed" | "warning" | "failed" | "blocked" | "needs_input"; exitCode: number }> = {
  passed: { status: "passed", exitCode: ExitCode.Success },
  warning: { status: "warning", exitCode: ExitCode.Success },
  failed: { status: "failed", exitCode: ExitCode.ValidationFailed },
  blocked: { status: "blocked", exitCode: ExitCode.WorkflowBlocked },
  needs_input: { status: "needs_input", exitCode: ExitCode.HumanInputRequired },
  cancelled: { status: "passed", exitCode: ExitCode.Success },
};

export function runMaintenanceRunDue(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-RUN-DUE-NO-PROJECT");
  }
  const { paths, state } = loadProject(ctx);
  const now = new Date().toISOString();
  const outcome = runDueMaintenanceOccurrence(ctx.cwd, paths, now);

  switch (outcome.kind) {
    case "lock_held":
      return maintenanceFailure("Another maintenance/workspace operation is already in progress.", ExitCode.WorkflowBlocked, "MAINTENANCE-RUN-DUE-LOCK-HELD");

    case "busy":
      return makeResult({
        status: "blocked",
        action: "maintenance",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Occurrence ${outcome.activeOccurrence.occurrenceId} is already active for schedule ${outcome.activeOccurrence.scheduleId}. No second occurrence was started.`,
        exitCode: ExitCode.WorkflowBlocked,
        data: { outcome: "busy", activeOccurrence: outcome.activeOccurrence },
      });

    case "reconciled_stale":
      return makeResult({
        status: "failed",
        action: "maintenance",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Occurrence ${outcome.occurrence.occurrenceId} for schedule ${outcome.occurrence.scheduleId} was interrupted and has been reconciled to "failed" (never assumed successful). No new occurrence was started this invocation.`,
        completedActions: ["Reconciled interrupted occurrence", "Wrote state.json", "Appended runlog event"],
        changedFiles: [paths.stateFile, paths.runlogFile],
        affectedItems: [outcome.occurrence.scheduleId],
        exitCode: ExitCode.ValidationFailed,
        data: { outcome: "reconciled_stale", occurrence: outcome.occurrence, schedule: outcome.schedule },
      });

    case "nothing_due":
      return makeResult({
        status: "passed",
        action: "maintenance",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: "No maintenance schedule is currently due.",
        exitCode: ExitCode.Success,
        data: { outcome: "nothing_due" },
      });

    case "unsupported_task_kind":
      return maintenanceFailure(`Task kind "${outcome.taskKind}" has no dispatch handler.`, ExitCode.InvalidInput, "MAINTENANCE-RUN-DUE-UNSUPPORTED-TASK-KIND");

    case "ran": {
      const mapping = RESULT_STATUS_EXIT[outcome.result.resultStatus];
      return makeResult({
        status: mapping.status,
        action: "maintenance",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Occurrence ${outcome.occurrenceId} for schedule ${outcome.schedule.id} (${outcome.schedule.taskKind}): ${outcome.result.summary}${outcome.missedOccurrenceCount > 0 ? ` (${outcome.missedOccurrenceCount} missed occurrence(s) skipped)` : ""}`,
        completedActions: ["Wrote state.json", "Appended runlog event(s)"],
        changedFiles: [paths.stateFile, paths.runlogFile],
        affectedItems: [outcome.schedule.id],
        exitCode: mapping.exitCode,
        requiresHumanInput: outcome.result.resultStatus === "needs_input",
        data: {
          outcome: "ran",
          occurrenceId: outcome.occurrenceId,
          scheduleId: outcome.schedule.id,
          taskKind: outcome.schedule.taskKind,
          missedOccurrenceCount: outcome.missedOccurrenceCount,
          resultStatus: outcome.result.resultStatus,
          nextDueAt: outcome.nextDueAt,
          result: outcome.result.data,
        },
      });
    }
  }
}

export function runMaintenanceCancel(ctx: CommandContext, occurrenceId: string): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-CANCEL-NO-PROJECT");
  }
  const { paths, state } = loadProject(ctx);
  const outcome = cancelMaintenanceOccurrence(paths, occurrenceId);
  if (!outcome.ok) {
    return maintenanceFailure(outcome.reason, ExitCode.InvalidInput, "MAINTENANCE-CANCEL-NOT-FOUND");
  }
  return makeResult({
    status: "passed",
    action: "maintenance",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `Cancelled occurrence ${occurrenceId} for schedule ${outcome.scheduleId}.`,
    completedActions: ["Wrote state.json", "Appended runlog event"],
    changedFiles: [paths.stateFile, paths.runlogFile],
    affectedItems: [outcome.scheduleId],
    exitCode: ExitCode.Success,
    data: { scheduleId: outcome.scheduleId, nextDueAt: outcome.nextDueAt },
  });
}
