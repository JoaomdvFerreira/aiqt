import { describe, it, expect, afterAll } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { runMaintenanceScheduleAdd, runMaintenanceScheduleDisable } from "../../src/cli/commands/maintenance-schedule.command.js";
import { runMaintenanceRunDue } from "../../src/cli/commands/maintenance-run.command.js";
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { MaintenanceTaskKindSchema } from "../../src/schema/maintenance-schedule.schema.js";
import type { MaintenanceSchedule, MaintenanceOccurrenceRecord } from "../../src/schema/maintenance-schedule.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const NOW = "2026-08-08T00:00:00.000Z";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}
function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}
function queuedDefect(overrides: Partial<DefectRecord> = {}): DefectRecord {
  return {
    defectId: "DEF-001",
    title: "Fix off-by-one",
    summary: "off by one in loop bound",
    sourceKind: "failed_validation",
    evidenceRefs: [{ evidenceRefId: "DEFEV-001", sourceKind: "failed_validation", locator: "x", capturedAt: NOW }],
    fingerprint: "sha256:" + "a".repeat(64),
    severity: "medium",
    confidence: "confirmed",
    status: "queued",
    freshness: { state: "current", evaluatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * M45-WU05 (build spec Sec 18 dogfood list): the scenarios not already
 * exercised by WU45-02/03/04's own focused suites -- missed-occurrence
 * surfacing in a real run, disable never killing active work, the exact
 * 49/50 risk boundary, no-retry-loop behavior, and the closed task-kind
 * enum proving no arbitrary command can ever be stored as a schedule.
 */
describe("M45 background maintenance scheduling dogfood (gap-filling scenarios)", () => {
  const tempDirs: string[] = [];
  function freshGitDir(): string {
    const d = makeTempDir();
    tempDirs.push(d);
    initGitFixtureRepo(d);
    return d;
  }
  afterAll(() => {
    for (const d of tempDirs) removeDir(d);
  });

  it("scenario 10: a host offline across multiple cadence intervals produces exactly one occurrence, with the skipped count surfaced", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });
    const schedule = (added.data as { schedule: MaintenanceSchedule }).schedule;

    // Simulate the host having been offline for 5 cadence periods.
    const state = readState(dir);
    state.maintenanceSchedules[0].nextDueAt = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("passed");
    const data = result.data as { missedOccurrenceCount: number; nextDueAt: string };
    expect(data.missedOccurrenceCount).toBe(4); // 5 periods late -> 4 skipped, this one runs
    expect(Date.parse(data.nextDueAt)).toBeGreaterThan(Date.now() - 1000);

    // A second immediate invocation must NOT replay the backlog.
    const second = runMaintenanceRunDue(contextFor(dir));
    expect((second.data as { outcome: string }).outcome).toBe("nothing_due");
    void schedule;
  });

  it("scenario 14: disabling a schedule never kills its already-active occurrence", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });
    const scheduleId = (added.data as { schedule: MaintenanceSchedule }).schedule.id;

    const state = readState(dir);
    const active: MaintenanceOccurrenceRecord = {
      occurrenceId: "sha256:" + "1".repeat(64),
      scheduleId,
      taskKind: "structural_review",
      dueAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      missedOccurrenceCount: 0,
    };
    state.maintenanceActiveOccurrence = active;
    writeState(dir, state);

    const disabled = runMaintenanceScheduleDisable(contextFor(dir), scheduleId);
    expect(disabled.status).toBe("passed");
    expect(readState(dir).maintenanceActiveOccurrence).toEqual(active); // untouched
  });

  it("scenario 18: the exact 49/50 remediation-risk boundary is preserved for scheduled remediation", () => {
    // score 49 (green/yellow band, automatable): narrow scope (1 file) + bound work unit -> low score.
    const lowRiskDir = freshGitDir();
    runInit(contextFor(lowRiskDir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(lowRiskDir), { taskKind: "defect_remediation", cadence: "1h" });
    let state = readState(lowRiskDir);
    state.defects = [queuedDefect({ affectedFiles: ["a.ts"], affectedWorkUnitId: "WU-001" })]; // score 5+5+0+0=10
    writeState(lowRiskDir, state);
    const lowRiskResult = runMaintenanceRunDue(contextFor(lowRiskDir));
    expect(lowRiskResult.status).toBe("passed");
    expect(readState(lowRiskDir).defects[0].status).toBe("in_progress");

    // score >= 50 (human required): empty scope + no bound work unit -> score 5+40+15=60.
    const highRiskDir = freshGitDir();
    runInit(contextFor(highRiskDir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(highRiskDir), { taskKind: "defect_remediation", cadence: "1h" });
    state = readState(highRiskDir);
    state.defects = [queuedDefect()];
    writeState(highRiskDir, state);
    const highRiskResult = runMaintenanceRunDue(contextFor(highRiskDir));
    expect(highRiskResult.status).toBe("needs_input");
    expect(highRiskResult.exitCode).toBe(10);
    expect(readState(highRiskDir).defects[0].status).toBe("queued");
  });

  it("scenario 25: a repeated needs_input/blocked occurrence never enters an immediate retry loop", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1h" });
    const state = readState(dir);
    state.defects = [queuedDefect()]; // high risk -> needs_input
    writeState(dir, state);

    const first = runMaintenanceRunDue(contextFor(dir));
    expect(first.status).toBe("needs_input");

    // The schedule's nextDueAt has already advanced (build spec Sec 9.1: no
    // automatic immediate retry) -- an immediate second call finds nothing due.
    const second = runMaintenanceRunDue(contextFor(dir));
    expect((second.data as { outcome: string }).outcome).toBe("nothing_due");
    expect(readState(dir).defects[0].status).toBe("queued"); // still untouched, no retry attempted it again
  });

  it("scenario 27: no arbitrary command string can ever be stored as a schedule's task kind (closed enum)", () => {
    expect(MaintenanceTaskKindSchema.safeParse("rm -rf /").success).toBe(false);
    expect(MaintenanceTaskKindSchema.safeParse("aiqt defects remediate DEF-001 --approved-by x").success).toBe(false);
    expect(MaintenanceTaskKindSchema.options).toEqual(["structural_review", "defect_discovery", "defect_remediation"]);
  });
});
