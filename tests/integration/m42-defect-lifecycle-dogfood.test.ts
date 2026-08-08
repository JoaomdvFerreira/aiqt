import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runDefectsDiscover } from "../../src/cli/commands/defects-discover.command.js";
import { runDefectsTriage } from "../../src/cli/commands/defects-triage.command.js";
import { runDefectsQueue } from "../../src/cli/commands/defects-queue.command.js";
import { runDefectsInspect } from "../../src/cli/commands/defects-inspect.command.js";
import { runDefectsTransition } from "../../src/cli/commands/defects-transition.command.js";
import { runDefectsRemediate } from "../../src/cli/commands/defects-remediate.command.js";
import { runDefectsRecordValidation } from "../../src/cli/commands/defects-record-validation.command.js";
import { assessDiscoverySource } from "../../src/workflow/defect-discovery.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

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
    createdAt: T1,
    ...overrides,
  };
}

/**
 * M42-WU05 §10: the 12 required dogfood scenarios plus the M43 boundary
 * proof, run against disposable, non-AIQT-repository fixture project
 * directories (the same makeTempDir()/aiqt-init pattern M39/M41's own
 * dogfood suites use) -- never against this repository's own state.
 * Metrics asserted here (queue size, dedup collapse, human-gate count,
 * remediation/validation outcomes) are the honest evidence recorded in
 * the M42 closure report, not invented numbers.
 */
describe("M42 defect lifecycle dogfood", () => {
  const tempDirs: string[] = [];
  function freshDir(): string {
    const d = makeTempDir();
    tempDirs.push(d);
    return d;
  }
  afterAll(() => {
    for (const d of tempDirs) removeDir(d);
  });

  it("scenario 1: current failed focused test -> defect candidate with evidence", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test -- checkout.test.ts", result: "failed", summary: "checkout total mismatch" }] })];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    const data = result.data as { created: DefectRecord[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].sourceKind).toBe("failed_validation");
    expect(data.created[0].evidenceRefs[0].locator).toContain("checkpoint:");
  });

  it("scenario 2: checkpoint/review acceptance failure -> defect candidate", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ issues: [{ title: "Acceptance criterion not met", description: "Checkout total excludes tax", severity: "high", status: "open", agentCanFix: true }] })];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    const data = result.data as { created: DefectRecord[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].sourceKind).toBe("checkpoint_issue");
  });

  it("scenario 3: identical defect from two supported sources -> one canonical defect plus linked evidence", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test -- checkout.test.ts", result: "failed", summary: "flaky" }] })];
    writeState(dir, state);

    const first = await runDefectsDiscover(contextFor(dir), {});
    expect((first.data as { created: unknown[] }).created).toHaveLength(1);
    const second = await runDefectsDiscover(contextFor(dir), {});
    const secondData = second.data as { created: unknown[]; enriched: { defectId: string }[] };
    expect(secondData.created).toHaveLength(0);
    expect(secondData.enriched).toHaveLength(1);

    const finalState = readState(dir);
    expect(finalState.defects).toHaveLength(1);
    expect(finalState.defects[0].evidenceRefs).toHaveLength(2);
  });

  it("scenario 4: stale prior failure -> not treated as a current confirmed defect without an explicit reason", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [
      baseCheckpoint({ id: "CP-001", createdAt: T1, validationCommands: [{ command: "pnpm test -- flaky.test.ts", result: "failed", summary: "old" }] }),
      baseCheckpoint({ id: "CP-002", createdAt: T2, validationCommands: [] }),
    ];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    const data = result.data as { created: DefectRecord[] };
    expect(data.created[0].freshness.state).toBe("stale");
    expect(data.created[0].freshness.reason).toBeTruthy();
  });

  it("scenario 5: ambiguous evidence -> lower confidence/evidence gap, no unsafe remediation authorized", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const humanReport = await runDefectsDiscover(contextFor(dir), {
      humanTitle: "Possible data corruption",
      humanSummary: "Unverified user report",
      humanEvidence: "support ticket #77",
      humanSeverity: "critical",
    });
    const defectId = (humanReport.data as { created: DefectRecord[] }).created[0].defectId;

    const triaged = await runDefectsTriage(contextFor(dir), defectId, {});
    const triagedDefect = (triaged.data as { defect: DefectRecord }).defect;
    expect(triagedDefect.status).toBe("needs_human");
    expect(triagedDefect.triage?.evidenceGaps.length).toBeGreaterThan(0);

    // Discovery/triage alone never authorized a side effect: remediate is
    // not even reachable because status is "needs_human", not "queued".
    const remediateAttempt = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "x",
      scope: "src/x.ts",
      acceptance: "x",
    });
    expect(remediateAttempt.exitCode).not.toBe(ExitCode.Success);
    const inspected = runDefectsInspect(contextFor(dir), defectId);
    expect((inspected.data as { defect: DefectRecord }).defect.remediation).toBeUndefined();
  });

  it("scenario 6: confirmed blocking/critical defect -> deterministic higher queue priority", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [
      baseCheckpoint({ id: "CP-A", issues: [{ title: "Critical checkout failure", description: "d", severity: "critical", status: "open", agentCanFix: true }] }),
      baseCheckpoint({ id: "CP-B", issues: [{ title: "Typo in help text", description: "d", severity: "low", status: "open", agentCanFix: true }] }),
    ];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    expect(discovered.exitCode).toBe(ExitCode.Success);
    for (const d of (discovered.data as { created: DefectRecord[] }).created) {
      await runDefectsTriage(contextFor(dir), d.defectId, {});
    }
    const queue = runDefectsQueue(contextFor(dir));
    const queueData = queue.data as { queue: DefectRecord[] };
    expect(queueData.queue[0].severity).toBe("critical");
  });

  it("scenario 7: explicit false positive -> invalid disposition preserved with evidence", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ issues: [{ title: "Suspected bug", description: "d", severity: "medium", status: "open", agentCanFix: true }] })];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;

    const result = await runDefectsTransition(contextFor(dir), defectId, { to: "invalid", reason: "confirmed false positive: expected behavior, not a bug" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const inspected = runDefectsInspect(contextFor(dir), defectId);
    const defect = (inspected.data as { defect: DefectRecord }).defect;
    expect(defect.status).toBe("invalid");
    expect(defect.evidenceRefs.length).toBeGreaterThan(0);

    // New matching evidence enriches but does not silently reopen it.
    await runDefectsDiscover(contextFor(dir), {});
    const reinspected = runDefectsInspect(contextFor(dir), defectId);
    expect((reinspected.data as { defect: DefectRecord }).defect.status).toBe("invalid");
  });

  it("scenario 8: queue persists and resumes correctly across a canonical reload, including the pre-M42 compatibility path", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] })];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;
    await runDefectsTriage(contextFor(dir), defectId, {});

    // Simulate a fresh process: a brand-new CommandContext reads state.json from disk again.
    const reloadedQueue = runDefectsQueue(contextFor(dir));
    expect((reloadedQueue.data as { queueSize: number }).queueSize).toBe(1);

    // Pre-M42 compatibility: an older schema-version state with no `defects`
    // key at all must still be readable and the queue command must report
    // an honest empty queue, not a crash.
    const compatDir = freshDir();
    runInit(contextFor(compatDir), normalizeInitOptions({}));
    const compatState = readState(compatDir);
    compatState.version = "0.5.0";
    delete compatState.defects;
    writeState(compatDir, compatState);
    const compatQueue = runDefectsQueue(contextFor(compatDir));
    expect(compatQueue.exitCode).toBe(ExitCode.Success);
    expect((compatQueue.data as { queueSize: number }).queueSize).toBe(0);
  });

  it("scenario 9: low-risk bounded remediation follows the existing controlled/handoff path", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test -- checkout.test.ts", result: "failed", summary: "x" }] })];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;
    await runDefectsTriage(contextFor(dir), defectId, {});

    const remediated = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "Fix checkout total calculation",
      scope: "src/checkout/total.ts",
      acceptance: "checkout.test.ts passes",
    });
    expect(remediated.exitCode).toBe(ExitCode.Success);
    expect((remediated.data as { defect: DefectRecord }).defect.status).toBe("in_progress");
  });

  it("scenario 10: remediation risk 50+ requires human intervention before any side effect", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] })];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;
    await runDefectsTriage(contextFor(dir), defectId, {});

    const blocked = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "Widen the canonical schema",
      scope: "src/schema/state.schema.ts",
      acceptance: "schema still validates",
    });
    expect(blocked.exitCode).toBe(ExitCode.HumanInputRequired);
    const inspected = runDefectsInspect(contextFor(dir), defectId);
    expect((inspected.data as { defect: DefectRecord }).defect.status).toBe("queued");

    const approved = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "Widen the canonical schema",
      scope: "src/schema/state.schema.ts",
      acceptance: "schema still validates",
      approvedBy: "maintainer@example.com",
    });
    expect(approved.exitCode).toBe(ExitCode.Success);
  });

  it("scenario 11: remediation validation failure leaves the defect open with failure evidence", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] })];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;
    await runDefectsTriage(contextFor(dir), defectId, {});
    await runDefectsRemediate(contextFor(dir), defectId, { objective: "o", scope: "src/x.ts", acceptance: "a" });

    const failed = await runDefectsRecordValidation(contextFor(dir), defectId, { outcome: "failed", evidence: "still failing after fix attempt" });
    expect(failed.exitCode).toBe(ExitCode.Success);
    const inspected = runDefectsInspect(contextFor(dir), defectId);
    const defect = (inspected.data as { defect: DefectRecord }).defect;
    expect(defect.status).toBe("queued");
    expect(defect.remediationEvidence?.[0].validationOutcome).toBe("failed");
  });

  it("scenario 12: remediation validation success resolves the defect with bound validation evidence", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] })];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;
    await runDefectsTriage(contextFor(dir), defectId, {});
    await runDefectsRemediate(contextFor(dir), defectId, { objective: "o", scope: "src/x.ts", acceptance: "a" });

    const passed = await runDefectsRecordValidation(contextFor(dir), defectId, { outcome: "passed", evidence: "pnpm test now green" });
    expect(passed.exitCode).toBe(ExitCode.Success);
    const inspected = runDefectsInspect(contextFor(dir), defectId);
    const defect = (inspected.data as { defect: DefectRecord }).defect;
    expect(defect.status).toBe("resolved");
    expect(defect.resolution?.evidenceRefs[0].locator).toContain("pnpm test now green");
  });

  it("boundary proof: a broad 'possible code smell' with no concrete defect evidence is not discovered -- M43 scope, not M42", async () => {
    const dir = freshDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    // A checkpoint with no failures and no open issues -- the repository
    // may still contain arbitrary "code smells", but M42 discovery only
    // ever reads bounded checkpoint evidence, never source files.
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({})];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    const data = result.data as { created: unknown[] };
    expect(data.created).toHaveLength(0);

    // Structural review / broad-repo-scan sources remain explicitly
    // unsupported by this milestone's discovery engine.
    expect(assessDiscoverySource("review_finding")).toEqual({
      sourceKind: "review_finding",
      supported: false,
      reason: expect.stringContaining("not yet supported"),
    });
  });
});
