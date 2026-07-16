import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}

function readRunlogLines(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

const DONE_PAYLOAD = {
  summary: "Implemented.",
  completed: ["Implemented."],
  notCompleted: [],
  filesChanged: ["src/example.ts"],
  validationResult: "passed",
  acceptanceCriteriaResult: "passed",
  validationCommands: [{ command: "pnpm test", result: "passed" }],
  acceptanceCriteria: [{ criterion: "Works", result: "passed" }],
  issues: [],
  notes: [],
};

const BASE_PLAN = {
  milestones: [
    { clientKey: "m1", title: "Corte 0", objective: "First cut." },
    { clientKey: "m2", title: "Corte 1 Roadmap", objective: "Placeholder for Corte 1." },
    { clientKey: "m3", title: "Corte 2 Roadmap", objective: "Placeholder for Corte 2." },
  ],
  workUnits: [
    {
      clientKey: "wu1",
      milestoneClientKey: "m1",
      title: "First unit",
      objective: "First unit objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu2",
      milestoneClientKey: "m2",
      title: "Corte 1 placeholder",
      objective: "Corte 1 placeholder objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu3",
      milestoneClientKey: "m3",
      title: "Corte 2 placeholder",
      objective: "Corte 2 placeholder objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [
    { fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" },
    { fromClientKey: "wu2", toClientKey: "wu3", type: "blocks" },
  ],
};

const EXTENSION_INPUT = {
  extension: {
    entryWorkUnitClientKeys: ["e1"],
    exitWorkUnitClientKeys: ["e2"],
    reason: "Detail Corte 1.",
  },
  milestones: [{ clientKey: "c1-m", title: "Corte 1 detail", objective: "Detailed Corte 1 work." }],
  workUnits: [
    {
      clientKey: "e1",
      milestoneClientKey: "c1-m",
      title: "Corte 1 entry",
      objective: "Entry objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "e2",
      milestoneClientKey: "c1-m",
      title: "Corte 1 exit",
      objective: "Exit objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [{ fromClientKey: "e1", toClientKey: "e2", type: "blocks" }],
};

/** Build a small non-empty graph: WU001 done, WU002 ready (the placeholder), WU003 planned/blocked behind WU002. */
async function makeExtendableProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(BASE_PLAN));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
  expect(runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD }).exitCode).toBe(ExitCode.Success);
}

describe("aiqt plan --extend: core CLI contract", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("A5: ordinary aiqt plan on a non-empty graph still returns PLAN-GRAPH-NOT-EMPTY, exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extraPlanPath = join(dir, "extra.json");
    writeFileSync(extraPlanPath, JSON.stringify(BASE_PLAN));
    const result = runPlan(contextFor(dir), { fromFile: extraPlanPath });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-GRAPH-NOT-EMPTY");
  });

  it("A6: aiqt plan --extend on an empty graph returns exit 2, PLAN-EXTEND-GRAPH-EMPTY, and recommends ordinary aiqt plan", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU001",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-GRAPH-EMPTY");
    expect(result.nextRecommendedCommand).toBe("aiqt plan");
  });

  it("A7: --extend without --replace-placeholder returns exit 3", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const result = runPlan(contextFor(dir), { extend: true });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("--replace-placeholder without --extend returns exit 3", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const result = runPlan(contextFor(dir), { replacePlaceholder: "WU002" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("A8: unknown placeholder returns exit 3", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU999",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-PLACEHOLDER-NOT-FOUND");
  });

  it("A1: applies a valid extension via --from-file, exit 0", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU002",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");

    const state = readState(dir);
    const placeholder = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
    expect(placeholder.status).toBe("replanned");
    expect(placeholder.replanReason).toBe("Detail Corte 1.");
    expect(state.workGraph.milestones).toHaveLength(4);
    expect(state.workGraph.workUnits).toHaveLength(5);
  });

  it("A2: --preview validates and reports the extension without writing files or appending runlog events", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readRunlogLines(dir).length;

    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU002",
      fromFile: extPath,
      preview: true,
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { preview: boolean; mutationPerformed: boolean };
    expect(data.preview).toBe(true);
    expect(data.mutationPerformed).toBe(false);

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("A46: JSON output keeps action 'plan' and reports operation 'extend' in data", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU002",
      fromFile: extPath,
    });
    expect(result.action).toBe("plan");
    const data = result.data as { operation: string; placeholderFinalStatus: string };
    expect(data.operation).toBe("extend");
    expect(data.placeholderFinalStatus).toBe("replanned");
  });

  it("A40: successful extension appends plan.extended and a work_unit.status_changed(replanned) runlog event", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    runPlan(contextFor(dir), { extend: true, replacePlaceholder: "WU002", fromFile: extPath });

    const lines = readRunlogLines(dir);
    const extended = lines.find((l) => l.type === "plan.extended")!;
    expect(extended).toBeDefined();
    expect(extended.data.placeholderWorkUnitId).toBe("WU002");
    expect(extended.data.reason).toBe("Detail Corte 1.");

    const replanned = lines.find(
      (l) =>
        l.type === "work_unit.status_changed" &&
        l.data.workUnitId === "WU002" &&
        l.data.toStatus === "replanned",
    )!;
    expect(replanned).toBeDefined();
    expect(replanned.data.toStatus).toBe("replanned");
  });

  it("A36: completed work units remain unchanged after extension", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const before = readState(dir).workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001");
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    runPlan(contextFor(dir), { extend: true, replacePlaceholder: "WU002", fromFile: extPath });
    const after = readState(dir).workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001");
    expect(after).toEqual(before);
  });

  it("A37/A30: first replacement entry is ready and downstream stays blocked until the new exit completes", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    runPlan(contextFor(dir), { extend: true, replacePlaceholder: "WU002", fromFile: extPath });

    const state = readState(dir);
    const entry = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Corte 1 entry");
    expect(entry.status).toBe("ready");
    const down = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU003");
    expect(down.status).toBe("planned");
  });
});

describe("aiqt plan --extend: placeholder eligibility", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  function extendAttempt(dir: string, placeholderId = "WU002") {
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(EXTENSION_INPUT));
    return runPlan(contextFor(dir), { extend: true, replacePlaceholder: placeholderId, fromFile: extPath });
  }

  it("A9/A10: placeholder ready or planned is allowed", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(extendAttempt(dir).exitCode).toBe(ExitCode.Success);
  });

  it("A11: placeholder blocked by an unsatisfied dependency is allowed (status planned)", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    // WU003 is "planned" (blocked behind WU002).
    const result = extendAttempt(dir, "WU003");
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("A12: placeholder in_progress is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success); // selects WU002, now the only ready work unit
    const result = extendAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-PLACEHOLDER-INELIGIBLE");
  });

  it("A14: placeholder done is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    expect(runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD }).exitCode).toBe(ExitCode.Success);
    const result = extendAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A13: placeholder needs_review is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    const partial = {
      ...DONE_PAYLOAD,
      acceptanceCriteriaResult: "partial",
      acceptanceCriteria: [{ criterion: "Criterion", result: "partial" }],
    };
    expect(runCheckpoint(contextFor(dir), { input: partial }).exitCode).toBe(ExitCode.Success);
    expect(readState(dir).workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002").status).toBe(
      "needs_review",
    );
    const result = extendAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A16: placeholder cancelled is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const state = readState(dir);
    const wu = state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU002");
    wu.status = "cancelled";
    writeState(dir, state);
    const result = extendAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A15: placeholder already replanned is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(extendAttempt(dir, "WU002").exitCode).toBe(ExitCode.Success);
    const result = extendAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A17: placeholder with a checkpoint on record is rejected with exit 2 even if its status was reset", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    expect(runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD }).exitCode).toBe(ExitCode.Success);
    const state = readState(dir);
    expect(state.checkpoints.some((cp: { workUnitId: string }) => cp.workUnitId === "WU002")).toBe(true);
    // Simulate a data anomaly: status reset to "ready" while checkpoint history remains.
    const wu = state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU002");
    wu.status = "ready";
    writeState(dir, state);
    const result = extendAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-PLACEHOLDER-HAS-HISTORY");
  });

  it("A18: placeholder with an active agent packet is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const state = readState(dir);
    state.lastAgentPacket = {
      id: "PKT-001",
      workUnitId: "WU002",
      milestoneId: "M002",
      createdAt: new Date().toISOString(),
      format: "markdown",
      contentHash: "abc",
      sourceCommand: "aiqt next",
    };
    writeState(dir, state);
    const result = extendAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-PLACEHOLDER-HAS-HISTORY");
  });
});
