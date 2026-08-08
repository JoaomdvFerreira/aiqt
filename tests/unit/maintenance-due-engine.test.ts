import { describe, it, expect } from "vitest";
import {
  computeInitialNextDueAt,
  computeMissedOccurrenceCount,
  computeNextDueAtAfterEvaluation,
  selectDueSchedule,
  computeOccurrenceId,
} from "../../src/workflow/maintenance-due-engine.js";
import type { MaintenanceSchedule } from "../../src/schema/maintenance-schedule.schema.js";

const DAY = "2026-08-01T00:00:00.000Z";
const ONE_DAY_SECONDS = 86400;

function schedule(overrides: Partial<MaintenanceSchedule> = {}): MaintenanceSchedule {
  return {
    id: "SCHED-001",
    taskKind: "structural_review",
    enabled: true,
    cadenceSeconds: ONE_DAY_SECONDS,
    anchorAt: DAY,
    nextDueAt: DAY,
    createdAt: DAY,
    updatedAt: DAY,
    lastOccurrenceAt: null,
    lastOccurrenceId: null,
    lastResultStatus: null,
    policy: {},
    ...overrides,
  };
}

describe("computeInitialNextDueAt", () => {
  it("is exactly the anchor", () => {
    expect(computeInitialNextDueAt(DAY)).toBe(DAY);
  });
});

describe("computeMissedOccurrenceCount (build spec Sec 9)", () => {
  it("is zero for an on-time run", () => {
    expect(computeMissedOccurrenceCount(DAY, DAY, ONE_DAY_SECONDS)).toBe(0);
  });

  it("is zero for a run at most one cadence period late", () => {
    const oneDayLate = new Date(Date.parse(DAY) + ONE_DAY_SECONDS * 1000).toISOString();
    expect(computeMissedOccurrenceCount(DAY, oneDayLate, ONE_DAY_SECONDS)).toBe(0);
  });

  it("matches the build spec's worked example: daily schedule offline 5 days -> 4 missed", () => {
    const fiveDaysLate = new Date(Date.parse(DAY) + 5 * ONE_DAY_SECONDS * 1000).toISOString();
    expect(computeMissedOccurrenceCount(DAY, fiveDaysLate, ONE_DAY_SECONDS)).toBe(4);
  });
});

describe("computeNextDueAtAfterEvaluation (anchor-aligned, always strictly after now)", () => {
  it("is deterministic for identical inputs", () => {
    const a = computeNextDueAtAfterEvaluation(DAY, ONE_DAY_SECONDS, DAY);
    const b = computeNextDueAtAfterEvaluation(DAY, ONE_DAY_SECONDS, DAY);
    expect(a).toBe(b);
  });

  it("is always strictly after the evaluation time, even far past due", () => {
    const fiveDaysLate = new Date(Date.parse(DAY) + 5 * ONE_DAY_SECONDS * 1000).toISOString();
    const next = computeNextDueAtAfterEvaluation(DAY, ONE_DAY_SECONDS, fiveDaysLate);
    expect(Date.parse(next)).toBeGreaterThan(Date.parse(fiveDaysLate));
    // anchor-aligned: exactly one cadence period past the evaluation point (day 6), not an arbitrary drift.
    expect(next).toBe(new Date(Date.parse(DAY) + 6 * ONE_DAY_SECONDS * 1000).toISOString());
  });

  it("never replays backlog: a single next due point results regardless of how many periods were missed", () => {
    const oneHundredDaysLate = new Date(Date.parse(DAY) + 100 * ONE_DAY_SECONDS * 1000).toISOString();
    const next = computeNextDueAtAfterEvaluation(DAY, ONE_DAY_SECONDS, oneHundredDaysLate);
    expect(next).toBe(new Date(Date.parse(DAY) + 101 * ONE_DAY_SECONDS * 1000).toISOString());
  });
});

describe("selectDueSchedule (build spec Sec 8.1/8.3)", () => {
  it("returns null (not an error) when nothing is due", () => {
    const future = new Date(Date.parse(DAY) + ONE_DAY_SECONDS * 1000).toISOString();
    const result = selectDueSchedule([schedule({ nextDueAt: future })], false, DAY);
    expect(result).toEqual({ ok: true, schedule: null });
  });

  it("never selects a disabled schedule even when its nextDueAt is due", () => {
    const result = selectDueSchedule([schedule({ enabled: false, nextDueAt: DAY })], false, DAY);
    expect(result).toEqual({ ok: true, schedule: null });
  });

  it("selects the earliest due schedule when multiple are due", () => {
    const earlier = new Date(Date.parse(DAY) - 3600 * 1000).toISOString();
    const s1 = schedule({ id: "SCHED-002", nextDueAt: DAY });
    const s2 = schedule({ id: "SCHED-001", nextDueAt: earlier });
    const result = selectDueSchedule([s1, s2], false, DAY);
    expect(result.ok).toBe(true);
    expect((result as { schedule: MaintenanceSchedule | null }).schedule?.id).toBe("SCHED-001");
  });

  it("breaks a due-time tie by stable schedule id", () => {
    const s1 = schedule({ id: "SCHED-002", nextDueAt: DAY });
    const s2 = schedule({ id: "SCHED-001", nextDueAt: DAY });
    const result = selectDueSchedule([s1, s2], false, DAY);
    expect(result.ok).toBe(true);
    expect((result as { schedule: MaintenanceSchedule | null }).schedule?.id).toBe("SCHED-001");
  });

  it("reports busy (not the underlying schedule) whenever an occurrence is already active", () => {
    const result = selectDueSchedule([schedule({ nextDueAt: DAY })], true, DAY);
    expect(result).toEqual({ ok: false, reason: "busy" });
  });

  it("is fully deterministic: identical state/time produces identical selection", () => {
    const schedules = [schedule({ id: "SCHED-002", nextDueAt: DAY }), schedule({ id: "SCHED-001", nextDueAt: DAY })];
    const a = selectDueSchedule(schedules, false, DAY);
    const b = selectDueSchedule(schedules, false, DAY);
    expect(a).toEqual(b);
  });
});

describe("computeOccurrenceId", () => {
  it("is deterministic for identical schedule state and due time", () => {
    const s = schedule();
    expect(computeOccurrenceId(s, DAY)).toBe(computeOccurrenceId(s, DAY));
  });

  it("changes when the schedule's cadence/policy configuration changes (future occurrence identity only)", () => {
    const s = schedule();
    const updated = schedule({ cadenceSeconds: ONE_DAY_SECONDS * 2 });
    expect(computeOccurrenceId(s, DAY)).not.toBe(computeOccurrenceId(updated, DAY));
  });

  it("changes when the due time changes", () => {
    const s = schedule();
    const laterDue = new Date(Date.parse(DAY) + ONE_DAY_SECONDS * 1000).toISOString();
    expect(computeOccurrenceId(s, DAY)).not.toBe(computeOccurrenceId(s, laterDue));
  });
});
