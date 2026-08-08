import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { runMaintenanceScheduleAdd } from "../../src/cli/commands/maintenance-schedule.command.js";
import { runMaintenanceRunDue } from "../../src/cli/commands/maintenance-run.command.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

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
 * M45-WU04: scheduled `defect_remediation` dispatch, against disposable,
 * non-AIQT fixture projects. Every scenario here was independently
 * confirmed by manual CLI dogfood before being encoded as a test (per
 * the requirement to prove risk-boundary/human-gate behavior honestly,
 * not merely assert it).
 */
describe("aiqt maintenance run-due (defect_remediation dispatch)", () => {
  const tempDirs: string[] = [];
  function freshDir(): string {
    const d = makeTempDir();
    tempDirs.push(d);
    return d;
  }
  afterAll(() => {
    for (const d of tempDirs) removeDir(d);
  });

  it("reports passed with no eligible defect when the queue is empty", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1h" });

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("passed");
    expect((result.data as { result: { selectedDefectId: string | null } }).result.selectedDefectId).toBeNull();
  });

  it("automatically prepares remediation for a low-risk (narrow-scope) queued defect -- risk 49 may proceed when all gates pass", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1h" });

    const state = readState(dir);
    state.defects = [queuedDefect({ affectedFiles: ["src/foo.ts"], affectedWorkUnitId: "WU-001" })];
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    const data = result.data as { resultStatus: string; result: { remediationId: string; riskScore: number } };
    expect(data.resultStatus).toBe("passed");
    expect(data.result.riskScore).toBeLessThan(50);

    const finalDefect: DefectRecord = readState(dir).defects[0];
    expect(finalDefect.status).toBe("in_progress");
    expect(finalDefect.remediation?.approvalRequired).toBe(false);
    expect(finalDefect.remediation?.approvedBy).toBeUndefined();
  });

  it("requires human approval (exit 10, no mutation) when risk reaches the global >=50 boundary -- risk 50 requires human intervention", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1h" });

    const state = readState(dir);
    state.defects = [queuedDefect()]; // no affectedFiles / no affectedWorkUnitId -> high risk
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("needs_input");
    expect(result.exitCode).toBe(10);
    expect(result.requiresHumanInput).toBe(true);

    const finalDefect: DefectRecord = readState(dir).defects[0];
    expect(finalDefect.status).toBe("queued"); // untouched
    expect(finalDefect.remediation).toBeUndefined();
  });

  it("a schedule's lower risk ceiling blocks a task the global policy would otherwise permit", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1h", maxAutomaticRisk: 5 });

    const state = readState(dir);
    state.defects = [queuedDefect({ affectedFiles: ["src/foo.ts"], affectedWorkUnitId: "WU-001" })]; // risk 10, globally automatable
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    expect(result.status).toBe("needs_input");
    expect(result.exitCode).toBe(10);

    const finalDefect: DefectRecord = readState(dir).defects[0];
    expect(finalDefect.status).toBe("queued");
  });

  it("selects at most one defect per occurrence even when multiple are queued (deterministic priority order)", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1h" });

    const state = readState(dir);
    state.defects = [
      queuedDefect({ defectId: "DEF-002", affectedFiles: ["src/b.ts"], affectedWorkUnitId: "WU-002", createdAt: "2026-08-02T00:00:00.000Z" }),
      queuedDefect({ defectId: "DEF-001", affectedFiles: ["src/a.ts"], affectedWorkUnitId: "WU-001", createdAt: "2026-08-01T00:00:00.000Z" }),
    ];
    writeState(dir, state);

    const result = runMaintenanceRunDue(contextFor(dir));
    const data = result.data as { result: { selectedDefectId: string } };
    expect(data.result.selectedDefectId).toBe("DEF-001"); // older, same priority (-1) -> stable tie-break by createdAt then id

    const finalDefects: DefectRecord[] = readState(dir).defects;
    expect(finalDefects.find((d) => d.defectId === "DEF-001")!.status).toBe("in_progress");
    expect(finalDefects.find((d) => d.defectId === "DEF-002")!.status).toBe("queued"); // untouched -- at most one per occurrence
  });

  it("never bridges to live sandboxed execution -- the remediation record carries no executionRef", () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runMaintenanceScheduleAdd(contextFor(dir), { taskKind: "defect_remediation", cadence: "1h" });

    const state = readState(dir);
    state.defects = [queuedDefect({ affectedFiles: ["src/foo.ts"], affectedWorkUnitId: "WU-001" })];
    writeState(dir, state);

    runMaintenanceRunDue(contextFor(dir));
    const finalDefect: DefectRecord = readState(dir).defects[0];
    expect(finalDefect.remediation?.executionRef).toBeUndefined();
    expect(finalDefect.remediation?.outcome).toBe("in_progress");
  });
});
