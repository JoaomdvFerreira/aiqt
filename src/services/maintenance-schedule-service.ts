import { nextId } from "../state/ids.js";
import { computeInitialNextDueAt, computeNextDueAtAfterEvaluation } from "../workflow/maintenance-due-engine.js";
import { MAX_MAINTENANCE_SCHEDULES } from "../schema/maintenance-schedule.schema.js";
import type { MaintenanceSchedule, MaintenanceSchedulePolicy, MaintenanceTaskKind } from "../schema/maintenance-schedule.schema.js";

/**
 * M45-WU02: pure schedule-mutation logic, mirroring
 * defect-discovery-service.ts's split -- no I/O, the caller (CLI command)
 * performs the actual `readStateModel`/`writeStateModel`/runlog-append
 * sequence around these functions. None of these mutate anything beyond
 * the returned `schedules` array; none ever execute a maintenance task
 * (build spec Sec 10: "none of those commands executes maintenance as a
 * side effect").
 */

export type ScheduleMutationOutcome =
  | { ok: true; schedule: MaintenanceSchedule; schedules: MaintenanceSchedule[] }
  | { ok: false; reason: string };

export interface AddScheduleInput {
  taskKind: MaintenanceTaskKind;
  cadenceSeconds: number;
  anchorAt: string;
  enabled: boolean;
  policy: MaintenanceSchedulePolicy;
  now: string;
}

/** Build spec Sec 7.4: a schedule always starts with zero occurrence history -- `add` never runs the task it schedules. */
export function addSchedule(existing: readonly MaintenanceSchedule[], input: AddScheduleInput): ScheduleMutationOutcome {
  if (existing.length >= MAX_MAINTENANCE_SCHEDULES) {
    return { ok: false, reason: `Cannot add another schedule: the maximum of ${MAX_MAINTENANCE_SCHEDULES} schedules has been reached.` };
  }
  const id = nextId("SCHED", existing.map((s) => s.id));
  const schedule: MaintenanceSchedule = {
    id,
    taskKind: input.taskKind,
    enabled: input.enabled,
    cadenceSeconds: input.cadenceSeconds,
    anchorAt: input.anchorAt,
    nextDueAt: computeInitialNextDueAt(input.anchorAt),
    createdAt: input.now,
    updatedAt: input.now,
    lastOccurrenceAt: null,
    lastOccurrenceId: null,
    lastResultStatus: null,
    policy: input.policy,
  };
  return { ok: true, schedule, schedules: [...existing, schedule] };
}

function findScheduleIndex(existing: readonly MaintenanceSchedule[], id: string): number {
  return existing.findIndex((s) => s.id === id);
}

function notFound(id: string): { ok: false; reason: string } {
  return { ok: false, reason: `Schedule "${id}" does not exist.` };
}

export interface UpdateScheduleInput {
  cadenceSeconds?: number;
  policy?: MaintenanceSchedulePolicy;
  now: string;
}

/**
 * Build spec dogfood scenario 13: a cadence change affects the FUTURE due
 * calculation only -- `nextDueAt` is recomputed strictly after `now` under
 * the new cadence, never retroactively rewriting past occurrence history
 * (which lives only in the runlog, untouched by this function). A
 * policy-only update leaves `nextDueAt` untouched.
 */
export function updateSchedule(existing: readonly MaintenanceSchedule[], id: string, input: UpdateScheduleInput): ScheduleMutationOutcome {
  const idx = findScheduleIndex(existing, id);
  if (idx === -1) return notFound(id);
  const current = existing[idx];

  const cadenceSeconds = input.cadenceSeconds ?? current.cadenceSeconds;
  const cadenceChanged = input.cadenceSeconds !== undefined && input.cadenceSeconds !== current.cadenceSeconds;
  const nextDueAt = cadenceChanged ? computeNextDueAtAfterEvaluation(current.anchorAt, cadenceSeconds, input.now) : current.nextDueAt;

  const updated: MaintenanceSchedule = {
    ...current,
    cadenceSeconds,
    policy: input.policy ?? current.policy,
    nextDueAt,
    updatedAt: input.now,
  };
  const schedules = [...existing];
  schedules[idx] = updated;
  return { ok: true, schedule: updated, schedules };
}

/** Build spec Sec 10: enabling/disabling never changes `nextDueAt` -- re-enabling resumes exactly where the schedule left off. */
function setEnabled(existing: readonly MaintenanceSchedule[], id: string, enabled: boolean, now: string): ScheduleMutationOutcome {
  const idx = findScheduleIndex(existing, id);
  if (idx === -1) return notFound(id);
  const updated: MaintenanceSchedule = { ...existing[idx], enabled, updatedAt: now };
  const schedules = [...existing];
  schedules[idx] = updated;
  return { ok: true, schedule: updated, schedules };
}

export function enableSchedule(existing: readonly MaintenanceSchedule[], id: string, now: string): ScheduleMutationOutcome {
  return setEnabled(existing, id, true, now);
}

export function disableSchedule(existing: readonly MaintenanceSchedule[], id: string, now: string): ScheduleMutationOutcome {
  return setEnabled(existing, id, false, now);
}

export type RemoveScheduleOutcome = { ok: true; schedules: MaintenanceSchedule[] } | { ok: false; reason: string };

/** Build spec Sec 10: removal never erases runlog history -- it only drops the current schedule record. The active-occurrence overlap check is the caller's responsibility (it needs `state.maintenanceActiveOccurrence`, which this pure function does not see). */
export function removeSchedule(existing: readonly MaintenanceSchedule[], id: string): RemoveScheduleOutcome {
  const idx = findScheduleIndex(existing, id);
  if (idx === -1) return notFound(id);
  return { ok: true, schedules: existing.filter((s) => s.id !== id) };
}
