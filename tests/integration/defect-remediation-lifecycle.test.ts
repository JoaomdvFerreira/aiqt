import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runDefectsDiscover } from "../../src/cli/commands/defects-discover.command.js";
import { runDefectsTriage } from "../../src/cli/commands/defects-triage.command.js";
import { runDefectsRemediate } from "../../src/cli/commands/defects-remediate.command.js";
import { runDefectsRecordValidation } from "../../src/cli/commands/defects-record-validation.command.js";
import { runDefectsInspect } from "../../src/cli/commands/defects-inspect.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

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

async function seedQueuedDefect(dir: string): Promise<string> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  const state = readState(dir);
  state.checkpoints = [
    baseCheckpoint({ validationCommands: [{ command: "pnpm test -- example.test.ts", result: "failed", summary: "1 test failing" }] }),
  ];
  writeState(dir, state);
  const discovered = await runDefectsDiscover(contextFor(dir), {});
  const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;
  const triaged = await runDefectsTriage(contextFor(dir), defectId, {});
  expect((triaged.data as { defect: DefectRecord }).defect.status).toBe("queued");
  return defectId;
}

describe("aiqt defects remediate / record-validation", () => {
  let dir: string;
  afterEach(() => {
    if (dir) removeDir(dir);
  });

  it("low-risk remediation proceeds automatically, then a passed validation resolves the defect (dogfood #9/#12)", async () => {
    dir = makeTempDir();
    const defectId = await seedQueuedDefect(dir);

    const remediated = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "Fix the failing assertion",
      scope: "src/cli/commands/example.command.ts",
      acceptance: "example.test.ts passes",
    });
    expect(remediated.exitCode).toBe(ExitCode.Success);
    const remediatedData = remediated.data as { defect: DefectRecord };
    expect(remediatedData.defect.status).toBe("in_progress");
    expect(remediatedData.defect.remediation?.approvalRequired).toBe(false);

    const validated = await runDefectsRecordValidation(contextFor(dir), defectId, {
      outcome: "passed",
      evidence: "pnpm test -- example.test.ts (1 passed)",
    });
    expect(validated.exitCode).toBe(ExitCode.Success);
    const inspected = runDefectsInspect(contextFor(dir), defectId);
    const finalDefect = (inspected.data as { defect: DefectRecord }).defect;
    expect(finalDefect.status).toBe("resolved");
    expect(finalDefect.resolution?.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("high-risk (foundational-path) remediation is blocked without --approved-by, persisting no side effect (dogfood #10)", async () => {
    dir = makeTempDir();
    const defectId = await seedQueuedDefect(dir);

    const blocked = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "Change canonical schema",
      scope: "src/schema/state.schema.ts",
      acceptance: "schema still validates",
    });
    expect(blocked.exitCode).toBe(ExitCode.HumanInputRequired);

    const inspected = runDefectsInspect(contextFor(dir), defectId);
    const defect = (inspected.data as { defect: DefectRecord }).defect;
    expect(defect.status).toBe("queued"); // unchanged -- no side effect authorized
    expect(defect.remediation).toBeUndefined();
  });

  it("the same high-risk remediation proceeds once an explicit human approver is supplied", async () => {
    dir = makeTempDir();
    const defectId = await seedQueuedDefect(dir);

    const approved = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "Change canonical schema",
      scope: "src/schema/state.schema.ts",
      acceptance: "schema still validates",
      approvedBy: "maintainer@example.com",
    });
    expect(approved.exitCode).toBe(ExitCode.Success);
    const data = approved.data as { defect: DefectRecord };
    expect(data.defect.status).toBe("in_progress");
    expect(data.defect.remediation?.approvedBy).toBe("maintainer@example.com");
  });

  it("a failed validation returns the defect to the queue with failure evidence, never silently resolved (dogfood #11)", async () => {
    dir = makeTempDir();
    const defectId = await seedQueuedDefect(dir);
    await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "Fix it",
      scope: "src/cli/commands/example.command.ts",
      acceptance: "test passes",
    });

    const failed = await runDefectsRecordValidation(contextFor(dir), defectId, {
      outcome: "failed",
      evidence: "pnpm test -- example.test.ts (still failing)",
    });
    expect(failed.exitCode).toBe(ExitCode.Success);

    const inspected = runDefectsInspect(contextFor(dir), defectId);
    const defect = (inspected.data as { defect: DefectRecord }).defect;
    expect(defect.status).toBe("queued");
    expect(defect.resolution).toBeUndefined();
    expect(defect.remediationEvidence?.length).toBe(1);
    expect(defect.remediationEvidence?.[0].validationOutcome).toBe("failed");
  });

  it("cannot remediate a defect that has not been queued (candidate)", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] })];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const defectId = (discovered.data as { created: DefectRecord[] }).created[0].defectId;

    const result = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "o",
      scope: "src/x.ts",
      acceptance: "a",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("cannot record validation without an in-progress remediation", async () => {
    dir = makeTempDir();
    const defectId = await seedQueuedDefect(dir);
    const result = await runDefectsRecordValidation(contextFor(dir), defectId, { outcome: "passed", evidence: "x" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("--preview on remediate does not persist", async () => {
    dir = makeTempDir();
    const defectId = await seedQueuedDefect(dir);
    const result = await runDefectsRemediate(contextFor(dir), defectId, {
      objective: "o",
      scope: "src/x.ts",
      acceptance: "a",
      preview: true,
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const finalState = readState(dir);
    expect(finalState.defects[0].status).toBe("queued");
  });
});
