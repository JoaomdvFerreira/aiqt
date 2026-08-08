import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runDefectsDiscover } from "../../src/cli/commands/defects-discover.command.js";
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

function seedProject(dir: string) {
  const initResult = runInit(contextFor(dir), normalizeInitOptions({}));
  expect(initResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt defects discover", () => {
  let dir: string;
  afterEach(() => {
    if (dir) removeDir(dir);
  });

  it("creates a defect candidate from a failed validation command", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    state.checkpoints = [
      baseCheckpoint({
        id: "CP-001",
        workUnitId: "WU-001",
        validationCommands: [{ command: "pnpm test", result: "failed", summary: "3 tests failing" }],
      }),
    ];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { created: DefectRecord[]; enriched: unknown[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].sourceKind).toBe("failed_validation");
    expect(data.created[0].status).toBe("candidate");
    expect(data.created[0].confidence).toBe("confirmed");
    expect(data.created[0].evidenceRefs).toHaveLength(1);

    const finalState = readState(dir);
    expect(finalState.defects).toHaveLength(1);
  });

  it("creates a defect candidate from an open checkpoint issue (acceptance failure)", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    state.checkpoints = [
      baseCheckpoint({
        issues: [{ title: "Missing null check", description: "Crashes on null input", severity: "high", status: "open", agentCanFix: true }],
      }),
    ];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { created: DefectRecord[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].sourceKind).toBe("checkpoint_issue");
    expect(data.created[0].severity).toBe("high");
  });

  it("dedups identical evidence from the same fingerprint into one canonical defect", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    state.checkpoints = [
      baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "flaky" }] }),
    ];
    writeState(dir, state);

    const first = await runDefectsDiscover(contextFor(dir), {});
    expect(first.exitCode).toBe(ExitCode.Success);
    const second = await runDefectsDiscover(contextFor(dir), {});
    expect(second.exitCode).toBe(ExitCode.Success);
    const secondData = second.data as { created: unknown[]; enriched: { defectId: string }[] };
    expect(secondData.created).toHaveLength(0);
    expect(secondData.enriched).toHaveLength(1);

    const finalState = readState(dir);
    expect(finalState.defects).toHaveLength(1);
    expect(finalState.defects[0].evidenceRefs).toHaveLength(2);
  });

  it("marks a superseded checkpoint's evidence as stale with an explicit reason", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    state.checkpoints = [
      baseCheckpoint({ id: "CP-001", createdAt: T1, validationCommands: [{ command: "pnpm test", result: "failed", summary: "old failure" }] }),
      baseCheckpoint({ id: "CP-002", createdAt: T2, validationCommands: [] }),
    ];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    const data = result.data as { created: DefectRecord[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].freshness.state).toBe("stale");
    expect(data.created[0].freshness.reason).toBeTruthy();
  });

  it("does not create a defect for a passing/no-issue checkpoint", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({})];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { created: unknown[] };
    expect(data.created).toHaveLength(0);
  });

  it("reports unsupported sources explicitly rather than silently ignoring them", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] })];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), {});
    const data = result.data as { unsupportedSources: { sourceKind: string; supported: boolean }[] };
    expect(data.unsupportedSources.length).toBeGreaterThan(0);
    expect(data.unsupportedSources.every((s) => s.supported === false)).toBe(true);
    expect(data.unsupportedSources.map((s) => s.sourceKind).sort()).toEqual(
      ["autonomous_execution_failure", "imported_external_evidence", "review_finding"].sort(),
    );
  });

  it("accepts an explicit human-reported candidate with suspected confidence", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const result = await runDefectsDiscover(contextFor(dir), {
      humanTitle: "Login button unresponsive",
      humanSummary: "Clicking login does nothing on Safari",
      humanEvidence: "manual test on Safari 18",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { created: DefectRecord[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].sourceKind).toBe("human_reported");
    expect(data.created[0].confidence).toBe("suspected");
  });

  it("rejects an incomplete human report", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const result = await runDefectsDiscover(contextFor(dir), { humanTitle: "Bug" });
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
  });

  it("--preview reports without persisting", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    state.checkpoints = [baseCheckpoint({ validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] })];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), { preview: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const finalState = readState(dir);
    expect(finalState.defects).toBeUndefined();
  });

  it("bounds discovery to --work-unit when supplied", async () => {
    dir = makeTempDir();
    seedProject(dir);
    const state = readState(dir);
    function stubWorkUnit(id: string) {
      return {
        id,
        milestoneId: "M-1",
        title: id,
        objective: "obj",
        scope: [],
        outOfScope: [],
        acceptanceCriteria: [],
        agentContextRefs: [],
        suggestedFiles: [],
        validationCommands: [],
        status: "done",
        dependencies: [],
        createdAt: T1,
        updatedAt: T1,
      };
    }
    state.workGraph.workUnits = [stubWorkUnit("WU-001"), stubWorkUnit("WU-002")];
    state.checkpoints = [
      baseCheckpoint({ id: "CP-001", workUnitId: "WU-001", validationCommands: [{ command: "pnpm test", result: "failed", summary: "x" }] }),
      baseCheckpoint({ id: "CP-002", workUnitId: "WU-002", validationCommands: [{ command: "pnpm lint", result: "failed", summary: "y" }] }),
    ];
    writeState(dir, state);

    const result = await runDefectsDiscover(contextFor(dir), { workUnitId: "WU-001" });
    const data = result.data as { created: DefectRecord[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].affectedWorkUnitId).toBe("WU-001");
  });
});
