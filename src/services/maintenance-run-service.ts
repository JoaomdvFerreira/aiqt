import { readStateModel, writeStateModel } from "../state/workflow-state-store.js";
import { acquireWorkspaceOperationLock, WorkspaceOperationLockError } from "../workspaces/workspace-operation-lock.js";
import { nextEventIdFactory } from "../workflow/execution-runlog-event-builder.js";
import {
  appendRunlogEvent,
  buildMaintenanceRunStartedEvent,
  buildMaintenanceRunCompletedEvent,
  buildMaintenanceRunFailedEvent,
  buildMaintenanceRunCancelledEvent,
} from "../state/runlog-store.js";
import { selectDueSchedule, computeMissedOccurrenceCount, computeNextDueAtAfterEvaluation, computeOccurrenceId } from "../workflow/maintenance-due-engine.js";
import { runStructuralReviewTask, runDefectDiscoveryTask, type MaintenanceTaskResult } from "../workflow/maintenance-task-handlers.js";
import type { AiqtPaths } from "../core/filesystem/paths.js";
import type { StateModel } from "../schema/state.schema.js";
import type { MaintenanceSchedule, MaintenanceOccurrenceRecord, MaintenanceOccurrenceResultStatus } from "../schema/maintenance-schedule.schema.js";

/**
 * M45-WU03/WU04: the sole `run-due`/`cancel` orchestration point. Reuses
 * the existing M25 workspace-operation lock (workspace-operation.lock,
 * shared with prepare/release workspace operations) to make the
 * read-select-claim sequence safe against two concurrent `run-due`
 * processes -- no new generic lock/transaction subsystem was built (build
 * spec Sec 8.2's stop condition). The lock is held only for that short
 * claim sequence, never for the task itself, which always completes
 * synchronously in-process (no live sandboxed execution is invoked --
 * see maintenance-task-handlers.ts / defect-remediation dispatch).
 */

const MAINTENANCE_LOCK_OPERATION_ID = "maintenance-run-due";
/** Build spec Sec 13.2: a claim older than this with no result recorded is treated as interrupted (the owning process crashed), never assumed successful. Every M45 task handler completes synchronously, so any survival past this bound is itself evidence of interruption. */
const STALE_OCCURRENCE_MS = 5 * 60 * 1000;

export type RunDueOutcome =
  | { kind: "busy"; activeOccurrence: MaintenanceOccurrenceRecord }
  | { kind: "reconciled_stale"; occurrence: MaintenanceOccurrenceRecord; schedule: MaintenanceSchedule | null }
  | { kind: "nothing_due" }
  | { kind: "unsupported_task_kind"; taskKind: string }
  | { kind: "ran"; schedule: MaintenanceSchedule; occurrenceId: string; missedOccurrenceCount: number; result: MaintenanceTaskResult; nextDueAt: string }
  | { kind: "lock_held" };

function updateScheduleAfterOccurrence(schedule: MaintenanceSchedule, occurrenceId: string, resultStatus: MaintenanceOccurrenceResultStatus, now: string): MaintenanceSchedule {
  return {
    ...schedule,
    lastOccurrenceAt: now,
    lastOccurrenceId: occurrenceId,
    lastResultStatus: resultStatus,
    nextDueAt: computeNextDueAtAfterEvaluation(schedule.anchorAt, schedule.cadenceSeconds, now),
    updatedAt: now,
  };
}

export function runDueMaintenanceOccurrence(cwd: string, paths: AiqtPaths, now: string = new Date().toISOString()): RunDueOutcome {
  let lock;
  try {
    lock = acquireWorkspaceOperationLock(paths.aiqtDir, MAINTENANCE_LOCK_OPERATION_ID);
  } catch (err) {
    if (err instanceof WorkspaceOperationLockError) return { kind: "lock_held" };
    throw err;
  }

  try {
    const state = readStateModel(paths.stateFile);
    const active = state.maintenanceActiveOccurrence ?? null;

    if (active !== null) {
      const ageMs = Date.parse(now) - Date.parse(active.startedAt);
      if (ageMs < STALE_OCCURRENCE_MS) {
        return { kind: "busy", activeOccurrence: active };
      }

      // Stale: the owning process almost certainly crashed. Reconcile to
      // "failed" -- never fabricate success (build spec Sec 13.2).
      const schedules = state.maintenanceSchedules ?? [];
      const idx = schedules.findIndex((s) => s.id === active.scheduleId);
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      let updatedSchedule: MaintenanceSchedule | null = null;
      let nextSchedules = schedules;
      if (idx !== -1) {
        updatedSchedule = updateScheduleAfterOccurrence(schedules[idx], active.occurrenceId, "failed", now);
        nextSchedules = [...schedules];
        nextSchedules[idx] = updatedSchedule;
      }
      const nextState: StateModel = { ...state, maintenanceSchedules: nextSchedules, maintenanceActiveOccurrence: null };
      writeStateModel(paths.stateFile, nextState);
      appendRunlogEvent(
        paths.runlogFile,
        buildMaintenanceRunFailedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [active.scheduleId, active.occurrenceId],
          data: {
            occurrenceId: active.occurrenceId,
            scheduleId: active.scheduleId,
            taskKind: active.taskKind,
            resultStatus: "failed",
            nextDueAt: updatedSchedule?.nextDueAt ?? active.dueAt,
            note: "Reconciled after apparent interruption (no result recorded within the expected window) -- never assumed successful.",
          },
        }),
      );
      return { kind: "reconciled_stale", occurrence: active, schedule: updatedSchedule };
    }

    const schedules = state.maintenanceSchedules ?? [];
    const selection = selectDueSchedule(schedules, false, now);
    if (!selection.ok) return { kind: "busy", activeOccurrence: active! };
    if (selection.schedule === null) return { kind: "nothing_due" };

    const schedule = selection.schedule;
    const dueAt = schedule.nextDueAt;
    const missedOccurrenceCount = computeMissedOccurrenceCount(dueAt, now, schedule.cadenceSeconds);
    const occurrenceId = computeOccurrenceId(schedule, dueAt);

    if (schedule.taskKind !== "structural_review" && schedule.taskKind !== "defect_discovery" && schedule.taskKind !== "defect_remediation") {
      return { kind: "unsupported_task_kind", taskKind: schedule.taskKind };
    }

    const claim: MaintenanceOccurrenceRecord = {
      occurrenceId,
      scheduleId: schedule.id,
      taskKind: schedule.taskKind,
      dueAt,
      startedAt: now,
      missedOccurrenceCount,
    };
    const claimedState: StateModel = { ...state, maintenanceActiveOccurrence: claim };
    writeStateModel(paths.stateFile, claimedState);
    const nextEventId = nextEventIdFactory(paths.runlogFile);
    appendRunlogEvent(
      paths.runlogFile,
      buildMaintenanceRunStartedEvent({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [schedule.id, occurrenceId],
        data: { occurrenceId, scheduleId: schedule.id, taskKind: schedule.taskKind, dueAt, missedOccurrenceCount },
      }),
    );

    // Release the lock now: the claim is durably persisted, so a second
    // concurrent run-due will see maintenanceActiveOccurrence !== null and
    // correctly report busy. The task itself never needs exclusivity.
    lock.release();
    lock = null;

    let taskResult: MaintenanceTaskResult;
    try {
      taskResult =
        schedule.taskKind === "structural_review"
          ? runStructuralReviewTask({ cwd, state: claimedState, schedule, now, allocateEventId: nextEventId })
          : schedule.taskKind === "defect_discovery"
            ? runDefectDiscoveryTask({ cwd, state: claimedState, schedule, now, allocateEventId: nextEventId })
            : (() => {
                throw new Error("defect_remediation dispatch is not yet available");
              })();
    } catch (err) {
      // A handler threw (e.g. the repository isn't a Git repo, so
      // structural review can't resolve a commit). The claim must never be
      // left stuck: reconcile to "failed" with the real error message as
      // evidence, exactly like the stale-occurrence path above -- never a
      // silently abandoned active occurrence.
      const message = err instanceof Error ? err.message : String(err);
      const failedSchedule = updateScheduleAfterOccurrence(schedule, occurrenceId, "failed", now);
      const finalSchedules = (claimedState.maintenanceSchedules ?? []).map((s) => (s.id === schedule.id ? failedSchedule : s));
      const finalState: StateModel = { ...claimedState, maintenanceSchedules: finalSchedules, maintenanceActiveOccurrence: null };
      writeStateModel(paths.stateFile, finalState);
      appendRunlogEvent(
        paths.runlogFile,
        buildMaintenanceRunFailedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [schedule.id, occurrenceId],
          data: { occurrenceId, scheduleId: schedule.id, taskKind: schedule.taskKind, resultStatus: "failed", nextDueAt: failedSchedule.nextDueAt, error: message },
        }),
      );
      return {
        kind: "ran",
        schedule: failedSchedule,
        occurrenceId,
        missedOccurrenceCount,
        result: { resultStatus: "failed", summary: `Task handler failed: ${message}`, nextState: finalState, additionalRunlogEvents: [], data: { error: message } },
        nextDueAt: failedSchedule.nextDueAt,
      };
    }

    const finalSchedules = (claimedState.maintenanceSchedules ?? []).map((s) => (s.id === schedule.id ? updateScheduleAfterOccurrence(s, occurrenceId, taskResult.resultStatus, now) : s));
    const finalState: StateModel = { ...taskResult.nextState, maintenanceSchedules: finalSchedules, maintenanceActiveOccurrence: null };
    writeStateModel(paths.stateFile, finalState);

    for (const evt of taskResult.additionalRunlogEvents) {
      appendRunlogEvent(paths.runlogFile, evt);
    }

    const finishedSchedule = finalSchedules.find((s) => s.id === schedule.id)!;
    const finishBuilder = taskResult.resultStatus === "failed" ? buildMaintenanceRunFailedEvent : buildMaintenanceRunCompletedEvent;
    appendRunlogEvent(
      paths.runlogFile,
      finishBuilder({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [schedule.id, occurrenceId],
        data: { occurrenceId, scheduleId: schedule.id, taskKind: schedule.taskKind, resultStatus: taskResult.resultStatus, nextDueAt: finishedSchedule.nextDueAt, ...taskResult.data },
      }),
    );

    return { kind: "ran", schedule: finishedSchedule, occurrenceId, missedOccurrenceCount, result: taskResult, nextDueAt: finishedSchedule.nextDueAt };
  } finally {
    if (lock) lock.release();
  }
}

export type CancelOutcome = { ok: true; scheduleId: string; nextDueAt: string | null } | { ok: false; reason: string };

/** Build spec Sec 13.1: no live process is ever signaled (M45 tasks always complete synchronously in-process) -- cancellation is bookkeeping that clears a stuck/active claim, never a kill of an unrelated process. */
export function cancelMaintenanceOccurrence(paths: AiqtPaths, occurrenceId: string, now: string = new Date().toISOString()): CancelOutcome {
  let lock;
  try {
    lock = acquireWorkspaceOperationLock(paths.aiqtDir, MAINTENANCE_LOCK_OPERATION_ID);
  } catch (err) {
    if (err instanceof WorkspaceOperationLockError) return { ok: false, reason: "Another maintenance/workspace operation is in progress; try again shortly." };
    throw err;
  }
  try {
    const state = readStateModel(paths.stateFile);
    const active = state.maintenanceActiveOccurrence;
    if (!active || active.occurrenceId !== occurrenceId) {
      return { ok: false, reason: `No active maintenance occurrence matches "${occurrenceId}".` };
    }

    const schedules = state.maintenanceSchedules ?? [];
    const idx = schedules.findIndex((s) => s.id === active.scheduleId);
    let nextSchedules = schedules;
    let nextDueAt: string | null = null;
    if (idx !== -1) {
      const updated = updateScheduleAfterOccurrence(schedules[idx], active.occurrenceId, "cancelled", now);
      nextSchedules = [...schedules];
      nextSchedules[idx] = updated;
      nextDueAt = updated.nextDueAt;
    }
    const nextState: StateModel = { ...state, maintenanceSchedules: nextSchedules, maintenanceActiveOccurrence: null };
    writeStateModel(paths.stateFile, nextState);

    const nextEventId = nextEventIdFactory(paths.runlogFile);
    appendRunlogEvent(
      paths.runlogFile,
      buildMaintenanceRunCancelledEvent({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [active.scheduleId, active.occurrenceId],
        data: { occurrenceId: active.occurrenceId, scheduleId: active.scheduleId, taskKind: active.taskKind, resultStatus: "cancelled", nextDueAt: nextDueAt ?? active.dueAt },
      }),
    );

    return { ok: true, scheduleId: active.scheduleId, nextDueAt };
  } finally {
    lock.release();
  }
}
