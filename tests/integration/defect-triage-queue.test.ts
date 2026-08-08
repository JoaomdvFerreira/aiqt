import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runDefectsDiscover } from "../../src/cli/commands/defects-discover.command.js";
import { runDefectsTriage } from "../../src/cli/commands/defects-triage.command.js";
import { runDefectsQueue } from "../../src/cli/commands/defects-queue.command.js";
import { runDefectsList } from "../../src/cli/commands/defects-list.command.js";
import { runDefectsInspect } from "../../src/cli/commands/defects-inspect.command.js";
import { runDefectsTransition } from "../../src/cli/commands/defects-transition.command.js";
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

async function seedOneDiscoveredDefect(dir: string, severity: "critical" | "high" | "medium" | "low" = "high"): Promise<string> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  const state = readState(dir);
  state.checkpoints = [
    baseCheckpoint({
      issues: [{ title: "Bug", description: "d", severity, status: "open", agentCanFix: true }],
    }),
  ];
  writeState(dir, state);
  const discovered = await runDefectsDiscover(contextFor(dir), {});
  const data = discovered.data as { created: DefectRecord[] };
  return data.created[0].defectId;
}

describe("aiqt defects triage/queue/list/inspect/transition", () => {
  let dir: string;
  afterEach(() => {
    if (dir) removeDir(dir);
  });

  it("full lifecycle: discover -> triage -> appears ordered in queue", async () => {
    dir = makeTempDir();
    const defectId = await seedOneDiscoveredDefect(dir, "high");

    const triaged = await runDefectsTriage(contextFor(dir), defectId, {});
    expect(triaged.exitCode).toBe(ExitCode.Success);
    const triagedData = triaged.data as { defect: DefectRecord; transitions: { from: string; to: string }[] };
    expect(triagedData.transitions.map((t) => `${t.from}->${t.to}`)).toEqual(["candidate->triaged", "triaged->queued"]);
    expect(triagedData.defect.status).toBe("queued");

    const queue = runDefectsQueue(contextFor(dir));
    const queueData = queue.data as { queue: DefectRecord[]; queueSize: number };
    expect(queueData.queueSize).toBe(1);
    expect(queueData.queue[0].defectId).toBe(defectId);
  });

  it("routes a low-confidence critical defect to needs_human, not the automated queue", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const humanReport = await runDefectsDiscover(contextFor(dir), {
      humanTitle: "Possible data loss",
      humanSummary: "Reported by a user, unverified",
      humanEvidence: "support ticket #123",
      humanSeverity: "critical",
    });
    const created = (humanReport.data as { created: DefectRecord[] }).created[0];
    expect(created.confidence).toBe("suspected");

    const triaged = await runDefectsTriage(contextFor(dir), created.defectId, {});
    expect(triaged.exitCode).toBe(ExitCode.Success);
    const triagedData = triaged.data as { defect: DefectRecord };
    expect(triagedData.defect.status).toBe("needs_human");
    expect(triagedData.defect.triage?.approvalAuthority).toBe("human_required");

    const queue = runDefectsQueue(contextFor(dir));
    const queueData = queue.data as { needsHumanCount: number; queueSize: number };
    expect(queueData.needsHumanCount).toBe(1);
    expect(queueData.queueSize).toBe(1); // needs_human is still queue-eligible (visible), just gated
  });

  it("orders a confirmed critical defect ahead of a confirmed low-severity one in the queue", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const state = readState(dir);
    state.checkpoints = [
      baseCheckpoint({
        id: "CP-A",
        issues: [{ title: "Critical bug", description: "d", severity: "critical", status: "open", agentCanFix: true }],
      }),
      baseCheckpoint({
        id: "CP-B",
        issues: [{ title: "Cosmetic issue", description: "d", severity: "low", status: "open", agentCanFix: true }],
      }),
    ];
    writeState(dir, state);
    const discovered = await runDefectsDiscover(contextFor(dir), {});
    const created = (discovered.data as { created: DefectRecord[] }).created;
    expect(created).toHaveLength(2);
    for (const d of created) {
      const result = await runDefectsTriage(contextFor(dir), d.defectId, {});
      expect(result.exitCode).toBe(ExitCode.Success);
    }

    const queue = runDefectsQueue(contextFor(dir));
    const queueData = queue.data as { queue: DefectRecord[] };
    expect(queueData.queue).toHaveLength(2);
    // deterministic priority ordering: confirmed critical outranks confirmed low
    expect(queueData.queue[0].severity).toBe("critical");
    expect(queueData.queue[1].severity).toBe("low");
  });

  it("aiqt defects list filters by --status", async () => {
    dir = makeTempDir();
    const defectId = await seedOneDiscoveredDefect(dir);
    await runDefectsTriage(contextFor(dir), defectId, {});

    const queued = runDefectsList(contextFor(dir), { status: "queued" });
    expect((queued.data as { defects: DefectRecord[] }).defects).toHaveLength(1);
    const candidate = runDefectsList(contextFor(dir), { status: "candidate" });
    expect((candidate.data as { defects: DefectRecord[] }).defects).toHaveLength(0);
  });

  it("aiqt defects inspect returns the full record with triage decision", async () => {
    dir = makeTempDir();
    const defectId = await seedOneDiscoveredDefect(dir);
    await runDefectsTriage(contextFor(dir), defectId, {});

    const inspected = runDefectsInspect(contextFor(dir), defectId);
    expect(inspected.exitCode).toBe(ExitCode.Success);
    const data = inspected.data as { defect: DefectRecord };
    expect(data.defect.triage).toBeDefined();
    expect(data.defect.triage?.reasonCodes.length).toBeGreaterThan(0);
  });

  it("aiqt defects transition marks an explicit false positive invalid, preserving evidence", async () => {
    dir = makeTempDir();
    const defectId = await seedOneDiscoveredDefect(dir);

    const result = await runDefectsTransition(contextFor(dir), defectId, { to: "invalid", reason: "confirmed false positive after manual review" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const inspected = runDefectsInspect(contextFor(dir), defectId);
    const data = inspected.data as { defect: DefectRecord };
    expect(data.defect.status).toBe("invalid");
    expect(data.defect.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("aiqt defects transition rejects an illegal jump (candidate -> resolved)", async () => {
    dir = makeTempDir();
    const defectId = await seedOneDiscoveredDefect(dir);
    const result = await runDefectsTransition(contextFor(dir), defectId, { to: "resolved", reason: "nope" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("re-triaging an already-queued defect fails closed with a clear reason (queued is not a triageable status)", async () => {
    dir = makeTempDir();
    const defectId = await seedOneDiscoveredDefect(dir);
    const first = await runDefectsTriage(contextFor(dir), defectId, {});
    expect(first.exitCode).toBe(ExitCode.Success);
    const second = await runDefectsTriage(contextFor(dir), defectId, {});
    expect(second.exitCode).toBe(ExitCode.InvalidInput);
    expect(second.summary).toContain("not triageable");
  });

  it("triage on an unknown defect id fails with exit 3", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runDefectsTriage(contextFor(dir), "DEF-999", {});
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("--preview on triage does not persist", async () => {
    dir = makeTempDir();
    const defectId = await seedOneDiscoveredDefect(dir);
    const result = await runDefectsTriage(contextFor(dir), defectId, { preview: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const finalState = readState(dir);
    expect(finalState.defects[0].status).toBe("candidate");
  });
});
