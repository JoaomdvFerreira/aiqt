import { describe, it, expect, afterAll } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { runMaintenanceScheduleAdd } from "../../src/cli/commands/maintenance-schedule.command.js";
import { runMaintenanceRunDue, runMaintenanceCancel } from "../../src/cli/commands/maintenance-run.command.js";
import { runMaintenanceStatus } from "../../src/cli/commands/maintenance-status.command.js";
import { resolveAiqtPaths } from "../../src/core/filesystem/paths.js";
import { runDueMaintenanceOccurrence } from "../../src/services/maintenance-run-service.js";
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import type { MaintenanceSchedule, MaintenanceOccurrenceRecord } from "../../src/schema/maintenance-schedule.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";

// M34-WU02 policy: real `git` subprocess fixture (initGitFixtureRepo).
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}
function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}
function baseCheckpoint(overrides: Partial<Checkpoint>): Checkpoint {
  return {
    id: "CP-001",
    workUnitId: "WU-001",
    packetId: null,
    summary: "checkpoint",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    issues: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "done",
    nextRecommendation: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * M45-WU03/WU04: `run-due` typed dispatch, against real disposable Git
 * fixture repositories (structural review needs a real commit to resolve
 * reviewCommit against). Never against this repository's own state.
 */
describe("aiqt maintenance run-due / cancel", () => {
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

  it("returns nothing_due with zero mutation when no schedule is due", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readState(dir);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect((result.data as { outcome: string }).outcome).toBe("nothing_due");
    expect(readState(dir)).toEqual(before);
  });

  it("runs a due structural_review occurrence read-only, records evidence, and creates zero defects", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("passed");
    const data = result.data as { outcome: string; resultStatus: string; result: { reviewCommit: string; findingCount: number } };
    expect(data.outcome).toBe("ran");
    expect(data.resultStatus).toBe("passed");
    expect(typeof data.result.reviewCommit).toBe("string");

    const state = readState(dir);
    expect(state.defects).toBeUndefined();
    expect(state.maintenanceActiveOccurrence).toBeNull();
    expect(state.maintenanceSchedules[0].lastResultStatus).toBe("passed");
  });

  it("runs a due defect_discovery occurrence reusing M42 discovery, and never authorizes remediation", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_discovery", cadence: "1h" });

    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test -- x.test.ts", result: "failed", summary: "boom" }] })];
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("passed");
    const data = result.data as { result: { created: string[] } };
    expect(data.result.created).toHaveLength(1);

    const finalState = readState(dir);
    const defect: DefectRecord = finalState.defects[0];
    expect(defect.status).toBe("candidate"); // never queued/in_progress by discovery alone
  });

  it("selects the earliest due schedule deterministically when multiple are due, tie-broken by stable id", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_discovery", cadence: "1h" });

    const result = runMaintenanceRunDue(contextFor(dir));
    expect((result.data as { scheduleId: string }).scheduleId).toBe("SCHED-001"); // lower id wins the due-time tie
  });

  it("reports busy (no mutation to schedules) when an occurrence is already active", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });
    const scheduleId = (added.data as { schedule: MaintenanceSchedule }).schedule.id;

    const state = readState(dir);
    const active: MaintenanceOccurrenceRecord = {
      occurrenceId: "sha256:" + "c".repeat(64),
      scheduleId,
      taskKind: "structural_review",
      dueAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      missedOccurrenceCount: 0,
    };
    state.maintenanceActiveOccurrence = active;
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
    expect((result.data as { outcome: string }).outcome).toBe("busy");
    expect(readState(dir).maintenanceActiveOccurrence).toEqual(active);
  });

  it("reconciles a stale active occurrence to failed (never fabricates success) and does not start new work in the same invocation", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });
    const scheduleId = (added.data as { schedule: MaintenanceSchedule }).schedule.id;

    const state = readState(dir);
    const staleStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago, past the 5-minute staleness bound
    state.maintenanceActiveOccurrence = {
      occurrenceId: "sha256:" + "d".repeat(64),
      scheduleId,
      taskKind: "structural_review",
      dueAt: staleStartedAt,
      startedAt: staleStartedAt,
      missedOccurrenceCount: 0,
    };
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("failed");
    expect((result.data as { outcome: string }).outcome).toBe("reconciled_stale");

    const finalState = readState(dir);
    expect(finalState.maintenanceActiveOccurrence).toBeNull();
    expect(finalState.maintenanceSchedules[0].lastResultStatus).toBe("failed");
  });

  it("cancel clears the active occurrence and advances the schedule without erasing history", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const added = runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });
    const scheduleId = (added.data as { schedule: MaintenanceSchedule }).schedule.id;

    const state = readState(dir);
    const occurrenceId = "sha256:" + "e".repeat(64);
    state.maintenanceActiveOccurrence = { occurrenceId, scheduleId, taskKind: "structural_review", dueAt: new Date().toISOString(), startedAt: new Date().toISOString(), missedOccurrenceCount: 0 };
    writeState(dir, state);

    const result = runMaintenanceCancel(contextFor(dir), occurrenceId);
    expect(result.status).toBe("passed");
    expect(readState(dir).maintenanceActiveOccurrence).toBeNull();

    const status = runMaintenanceStatus(contextFor(dir));
    expect((status.data as { activeOccurrence: unknown }).activeOccurrence).toBeNull();
  });

  it("cancel fails closed for a non-matching occurrence id", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runMaintenanceCancel(contextFor(dir), "sha256:" + "f".repeat(64));
    expect(result.blockingIssues[0]?.id).toBe("MAINTENANCE-CANCEL-NOT-FOUND");
  });

  it("service-level: identical due selection is deterministic across repeated calls with the same injected now", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "structural_review", cadence: "1h" });
    const paths = resolveAiqtPaths(dir);
    const fixedNow = "2026-08-08T00:00:00.000Z";

    // Force nextDueAt to the fixed point so both calls see identical due state.
    const state = readState(dir);
    state.maintenanceSchedules[0].nextDueAt = fixedNow;
    writeState(dir, state);

    const first = runDueMaintenanceOccurrence(dir, paths, fixedNow);
    expect(first.kind).toBe("ran");

    // Re-run against the now-advanced state at the same fixed "now" -- nothing should be due again.
    const second = runDueMaintenanceOccurrence(dir, paths, fixedNow);
    expect(second.kind).toBe("nothing_due");
  });
});
