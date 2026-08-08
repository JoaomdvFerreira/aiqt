import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import {
  runMaintenanceScheduleAdd,
  runMaintenanceScheduleList,
  runMaintenanceScheduleInspect,
  runMaintenanceScheduleUpdate,
  runMaintenanceScheduleEnable,
  runMaintenanceScheduleDisable,
  runMaintenanceScheduleRemove,
} from "../../src/cli/commands/maintenance-schedule.command.js";
import { runMaintenanceStatus, runMaintenanceHistory } from "../../src/cli/commands/maintenance-status.command.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { MaintenanceSchedule } from "../../src/schema/maintenance-schedule.schema.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}
function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}

/**
 * M45-WU02: schedule CRUD + status/history against disposable, non-AIQT
 * fixture project directories (the same makeTempDir()/aiqt-init pattern
 * M42's own dogfood suite uses). No occurrence is ever executed here --
 * that is WU45-03/04's typed dispatch, layered on top of this CRUD
 * surface without changing it.
 */
describe("aiqt maintenance schedule/status/history CLI", () => {
  const tempDirs: string[] = [];
  function freshDir(): string {
    const d = makeTempDir();
    tempDirs.push(d);
    return d;
  }
  afterAll(() => {
    for (const d of tempDirs) removeDir(d);
  });

  it("pre-M45 project has zero schedules by default (no implicit schedule creation on init)", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    expect(state.maintenanceSchedules).toBeUndefined();

    const status = runMaintenanceStatus(contextFor(dir));
    const data = status.data as { totalSchedules: number };
    expect(data.totalSchedules).toBe(0);
  });

  it("add creates an enabled schedule by default, and it is immediately visible via list/inspect", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));

    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1d" });
    expect(added.exitCode).toBe(0);
    const schedule = (added.data as { schedule: MaintenanceSchedule }).schedule;
    expect(schedule.enabled).toBe(true);
    expect(schedule.taskKind).toBe("structural_review");
    expect(schedule.cadenceSeconds).toBe(86400);

    const list = runMaintenanceScheduleList(contextFor(dir));
    expect((list.data as { schedules: MaintenanceSchedule[] }).schedules).toHaveLength(1);

    const inspect = runMaintenanceScheduleInspect(contextFor(dir), schedule.id);
    expect(inspect.exitCode).toBe(0);
    expect((inspect.data as { schedule: MaintenanceSchedule }).schedule.id).toBe(schedule.id);
  });

  it("--disabled creates a schedule that starts disabled", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_discovery", cadence: "6h", disabled: true });
    expect((added.data as { schedule: MaintenanceSchedule }).schedule.enabled).toBe(false);
  });

  it("rejects an invalid task kind, cadence, and out-of-range policy", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    expect(runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "bogus", cadence: "1d" }).blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-ADD-INVALID-TASK-KIND");
    expect(runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "5m" }).blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-ADD-INVALID-CADENCE");
    expect(runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1d", maxAutomaticRisk: 60 }).blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-ADD-INVALID-POLICY");
  });

  it("update changes cadence and recomputes nextDueAt strictly after now; policy-only update leaves nextDueAt untouched", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1d", maxAutomaticRisk: 30 });
    const id = (added.data as { schedule: MaintenanceSchedule }).schedule.id;
    const originalNextDueAt = (added.data as { schedule: MaintenanceSchedule }).schedule.nextDueAt;

    const policyOnly = runMaintenanceScheduleUpdate(contextFor(dir), id, { maxAutomaticRisk: 20 });
    expect((policyOnly.data as { schedule: MaintenanceSchedule }).schedule.nextDueAt).toBe(originalNextDueAt);
    expect((policyOnly.data as { schedule: MaintenanceSchedule }).schedule.policy.maxAutomaticRisk).toBe(20);

    const cadenceChange = runMaintenanceScheduleUpdate(contextFor(dir), id, { cadence: "7d" });
    const updated = (cadenceChange.data as { schedule: MaintenanceSchedule }).schedule;
    expect(updated.cadenceSeconds).toBe(7 * 86400);
    expect(Date.parse(updated.nextDueAt)).toBeGreaterThan(Date.now() - 1000);
  });

  it("rejects update with no changes requested, and update/enable/disable/remove of an unknown schedule id", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    expect(runMaintenanceScheduleUpdate(contextFor(dir), "SCHED-999", {}).blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-UPDATE-NO-CHANGES");
    expect(runMaintenanceScheduleUpdate(contextFor(dir), "SCHED-999", { cadence: "1d" }).blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-UPDATE-NOT-FOUND");
    expect(runMaintenanceScheduleEnable(contextFor(dir), "SCHED-999").blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-ENABLE-NOT-FOUND");
    expect(runMaintenanceScheduleDisable(contextFor(dir), "SCHED-999").blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-DISABLE-NOT-FOUND");
    expect(runMaintenanceScheduleRemove(contextFor(dir), "SCHED-999").blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-REMOVE-NOT-FOUND");
  });

  it("disable then enable round-trips enabled state without changing nextDueAt", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1d" });
    const schedule = (added.data as { schedule: MaintenanceSchedule }).schedule;

    const disabled = runMaintenanceScheduleDisable(contextFor(dir), schedule.id);
    expect((disabled.data as { schedule: MaintenanceSchedule }).schedule.enabled).toBe(false);
    expect((disabled.data as { schedule: MaintenanceSchedule }).schedule.nextDueAt).toBe(schedule.nextDueAt);

    const enabled = runMaintenanceScheduleEnable(contextFor(dir), schedule.id);
    expect((enabled.data as { schedule: MaintenanceSchedule }).schedule.enabled).toBe(true);
    expect((enabled.data as { schedule: MaintenanceSchedule }).schedule.nextDueAt).toBe(schedule.nextDueAt);

    const status = runMaintenanceStatus(contextFor(dir));
    expect((status.data as { enabledSchedules: number }).enabledSchedules).toBe(1);
  });

  it("remove preserves runlog history but drops the schedule", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1d" });
    const id = (added.data as { schedule: MaintenanceSchedule }).schedule.id;

    const removed = runMaintenanceScheduleRemove(contextFor(dir), id);
    expect(removed.exitCode).toBe(0);
    expect(runMaintenanceScheduleList(contextFor(dir)).data).toEqual({ schedules: [] });

    const history = runMaintenanceHistory(contextFor(dir), {});
    const events = (history.data as { events: { type: string }[] }).events;
    expect(events.some((e) => e.type === "maintenance.schedule_created")).toBe(true);
    expect(events.some((e) => e.type === "maintenance.schedule_removed")).toBe(true);
  });

  it("remove fails closed when the schedule has an active occurrence", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1d" });
    const id = (added.data as { schedule: MaintenanceSchedule }).schedule.id;

    const state = readState(dir);
    state.maintenanceActiveOccurrence = { occurrenceId: "sha256:" + "a".repeat(64), scheduleId: id, taskKind: "structural_review", dueAt: new Date().toISOString(), startedAt: new Date().toISOString(), missedOccurrenceCount: 0 };
    writeState(dir, state);

    const removed = runMaintenanceScheduleRemove(contextFor(dir), id);
    expect(removed.blockingIssues[0]?.id).toBe("MAINTENANCE-SCHEDULE-REMOVE-ACTIVE-OCCURRENCE");
    expect(runMaintenanceScheduleList(contextFor(dir)).data).toEqual({ schedules: [{ ...(added.data as { schedule: MaintenanceSchedule }).schedule }] });
  });

  it("history filters by scheduleId and respects --limit", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const a = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1d" });
    const b = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_discovery", cadence: "1d" });
    const idA = (a.data as { schedule: MaintenanceSchedule }).schedule.id;
    const idB = (b.data as { schedule: MaintenanceSchedule }).schedule.id;

    const onlyA = runMaintenanceHistory(contextFor(dir), { scheduleId: idA });
    const events = (onlyA.data as { events: { relatedIds: string[] }[] }).events;
    expect(events.every((e) => e.relatedIds.includes(idA))).toBe(true);
    expect(events.some((e) => e.relatedIds.includes(idB))).toBe(false);

    const limited = runMaintenanceHistory(contextFor(dir), { limit: 1 });
    expect((limited.data as { events: unknown[] }).events).toHaveLength(1);
  });

  it("status reports the active occurrence when one exists, taking priority over next-due reporting", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1d" });
    const id = (added.data as { schedule: MaintenanceSchedule }).schedule.id;

    const state = readState(dir);
    state.maintenanceActiveOccurrence = { occurrenceId: "sha256:" + "b".repeat(64), scheduleId: id, taskKind: "structural_review", dueAt: new Date().toISOString(), startedAt: new Date().toISOString(), missedOccurrenceCount: 0 };
    writeState(dir, state);

    const status = runMaintenanceStatus(contextFor(dir));
    expect(status.summary).toContain("is active");
    expect((status.data as { activeOccurrence: { scheduleId: string } | null }).activeOccurrence?.scheduleId).toBe(id);
  });
});
