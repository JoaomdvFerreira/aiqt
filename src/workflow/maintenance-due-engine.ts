import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { MaintenanceSchedule } from "../schema/maintenance-schedule.schema.js";

/**
 * M45-WU02 (build spec Sec 8, 9): pure, injectable-clock due-time
 * calculation. No I/O, no wall-clock reads -- every function takes its
 * "now" as an explicit ISO 8601 string so selection is fully deterministic
 * and testable (build spec acceptance criterion: "identical state/time
 * produces identical selection").
 */

/** The schedule's first-ever due point is exactly its anchor -- a schedule is immediately eligible unless created with a future anchorAt. */
export function computeInitialNextDueAt(anchorAtIso: string): string {
  return anchorAtIso;
}

/**
 * Build spec Sec 9: how many cadence points were skipped between the point
 * being run (`dueAtIso`) and the current evaluation time, before this one.
 * A run that is at most one cadence period late (the ordinary case) always
 * reports 0 -- "missed" only counts periods a host being offline caused to
 * be skipped entirely, not the single period actually being executed.
 */
export function computeMissedOccurrenceCount(dueAtIso: string, evaluationTimeIso: string, cadenceSeconds: number): number {
  const dueMs = Date.parse(dueAtIso);
  const evalMs = Date.parse(evaluationTimeIso);
  const cadenceMs = cadenceSeconds * 1000;
  const elapsedMs = evalMs - dueMs;
  if (elapsedMs <= 0) return 0;
  const periodsElapsed = Math.floor(elapsedMs / cadenceMs);
  return Math.max(0, periodsElapsed - 1);
}

/**
 * Build spec Sec 9 point 3: advances to the first anchor-aligned cadence
 * point strictly after `evaluationTimeIso` -- never `dueAt + cadence`
 * (which could still be <= now after a long offline gap, causing an
 * immediate re-due and a backlog-replay risk). Anchor-aligned so cadence
 * points never drift regardless of when occurrences actually ran.
 */
export function computeNextDueAtAfterEvaluation(anchorAtIso: string, cadenceSeconds: number, evaluationTimeIso: string): string {
  const anchorMs = Date.parse(anchorAtIso);
  const evalMs = Date.parse(evaluationTimeIso);
  const cadenceMs = cadenceSeconds * 1000;
  const indexAfterEval = Math.floor((evalMs - anchorMs) / cadenceMs) + 1;
  const nextDueMs = anchorMs + indexAfterEval * cadenceMs;
  return new Date(nextDueMs).toISOString();
}

export type SelectDueScheduleResult =
  | { ok: true; schedule: MaintenanceSchedule | null }
  | { ok: false; reason: "busy" };

/**
 * Build spec Sec 8.1/8.3: enabled schedules only, earliest `nextDueAt`
 * first, stable schedule-id tie-break. Returns `schedule: null` (not an
 * error) when nothing is due -- "no due work" is a normal, successful
 * outcome (build spec Sec 16). Returns `{ ok: false, reason: "busy" }`
 * whenever an occurrence is already active, before even considering due
 * schedules -- overlap is checked first so a busy project never silently
 * looks like "nothing due" (build spec Sec 8.3).
 */
export function selectDueSchedule(schedules: readonly MaintenanceSchedule[], hasActiveOccurrence: boolean, nowIso: string): SelectDueScheduleResult {
  if (hasActiveOccurrence) return { ok: false, reason: "busy" };

  const nowMs = Date.parse(nowIso);
  const due = schedules.filter((s) => s.enabled && Date.parse(s.nextDueAt) <= nowMs);
  if (due.length === 0) return { ok: true, schedule: null };

  const sorted = [...due].sort((a, b) => {
    const dueDiff = Date.parse(a.nextDueAt) - Date.parse(b.nextDueAt);
    if (dueDiff !== 0) return dueDiff;
    return a.id.localeCompare(b.id);
  });
  return { ok: true, schedule: sorted[0] };
}

/**
 * Build spec Sec 8: deterministic occurrence identity over the exact
 * facts that determine "which occurrence this is" -- schedule identity,
 * its current cadence/policy configuration (so a schedule update changes
 * future occurrence identity only, build spec dogfood scenario 13), and
 * the due point itself. Digest only, never used as a history-scan key --
 * idempotency comes from the nextDueAt state machine (see
 * maintenance-schedule-service.ts), not from re-deriving and comparing
 * this id against stored history.
 */
export function computeOccurrenceId(schedule: MaintenanceSchedule, dueAtIso: string): string {
  return computeCanonicalPayloadDigest({
    scheduleId: schedule.id,
    taskKind: schedule.taskKind,
    cadenceSeconds: schedule.cadenceSeconds,
    policy: schedule.policy,
    dueAt: dueAtIso,
  });
}
