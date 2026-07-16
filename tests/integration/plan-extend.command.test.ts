import { describe, it, expect, afterEach, vi } from "vitest";
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
import * as workflowStateStore from "../../src/state/workflow-state-store.js";

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
    { clientKey: "m1", title: "Completed upstream work", objective: "Foundational work already done." },
    { clientKey: "m2", title: "Refinable future work", objective: "Placeholder for future detailed work." },
    { clientKey: "m3", title: "Further future work", objective: "Placeholder for later detailed work." },
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
      title: "Refinable future work unit",
      objective: "Future work objective.",
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
      title: "Further future work unit",
      objective: "Further future work objective.",
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

const REFINEMENT_INPUT = {
  extension: {
    entryWorkUnitClientKeys: ["e1"],
    exitWorkUnitClientKeys: ["e2"],
    reason: "Detail the refinable future work.",
  },
  milestones: [{ clientKey: "r-m", title: "Refinement detail", objective: "Detailed replacement work." }],
  workUnits: [
    {
      clientKey: "e1",
      milestoneClientKey: "r-m",
      title: "Replacement entry",
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
      milestoneClientKey: "r-m",
      title: "Replacement exit",
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

/** Build a small non-empty graph: WU001 done, WU002 ready (refinable), WU003 planned/blocked behind WU002. */
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
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU001",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-GRAPH-EMPTY");
    expect(result.nextRecommendedCommand).toBe("aiqt plan");
  });

  it("--extend without a refinement target on a non-empty graph selects append, not an error", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const appendPath = join(dir, "append.json");
    writeFileSync(appendPath, JSON.stringify({ milestones: [], workUnits: [], dependencies: [] }));
    const result = runPlan(contextFor(dir), { extend: true, fromFile: appendPath });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { operation: string };
    expect(data.operation).toBe("append");
  });

  it("--refine-work-unit and --replace-placeholder together return exit 3", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU002",
      replacePlaceholder: "WU002",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("--refine-work-unit without --extend returns exit 3", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const result = runPlan(contextFor(dir), { refineWorkUnit: "WU002" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("A8: unknown refinement target returns exit 3", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU999",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-TARGET-NOT-FOUND");
  });

  it("A1: applies a valid refinement via --from-file, exit 0", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU002",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");

    const state = readState(dir);
    const target = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
    expect(target.status).toBe("replanned");
    expect(target.replanReason).toBe("Detail the refinable future work.");
    expect(state.workGraph.milestones).toHaveLength(4);
    expect(state.workGraph.workUnits).toHaveLength(5);
  });

  it("A2: --preview validates and reports the refinement without writing files or appending runlog events", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readRunlogLines(dir).length;

    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU002",
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

  it("A46: JSON output keeps action 'plan' and reports operation 'refine' in data", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU002",
      fromFile: extPath,
    });
    expect(result.action).toBe("plan");
    const data = result.data as { operation: string; targetFinalStatus: string };
    expect(data.operation).toBe("refine");
    expect(data.targetFinalStatus).toBe("replanned");
  });

  it("A40: successful refinement appends plan.extended and a work_unit.status_changed(replanned) runlog event", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath });

    const lines = readRunlogLines(dir);
    const extended = lines.find((l) => l.type === "plan.extended")!;
    expect(extended).toBeDefined();
    expect(extended.data.operation).toBe("refine");
    expect(extended.data.targetWorkUnitId).toBe("WU002");
    expect(extended.data.reason).toBe("Detail the refinable future work.");

    const replanned = lines.find(
      (l) =>
        l.type === "work_unit.status_changed" &&
        l.data.workUnitId === "WU002" &&
        l.data.toStatus === "replanned",
    )!;
    expect(replanned).toBeDefined();
    expect(replanned.data.toStatus).toBe("replanned");
  });

  it("A36: completed work units remain unchanged after refinement", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const before = readState(dir).workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001");
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath });
    const after = readState(dir).workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001");
    expect(after).toEqual(before);
  });

  it("A37/A30: first replacement entry is ready and downstream stays blocked until the new exit completes", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath });

    const state = readState(dir);
    const entry = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Replacement entry");
    expect(entry.status).toBe("ready");
    const down = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU003");
    expect(down.status).toBe("planned");
  });
});

describe("aiqt plan --extend: refinement target eligibility", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  function refineAttempt(dir: string, targetWorkUnitId = "WU002") {
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    return runPlan(contextFor(dir), { extend: true, refineWorkUnit: targetWorkUnitId, fromFile: extPath });
  }

  it("A9/A10: target ready or planned is allowed", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(refineAttempt(dir).exitCode).toBe(ExitCode.Success);
  });

  it("A11: target blocked by an unsatisfied dependency is allowed (status planned)", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    // WU003 is "planned" (blocked behind WU002).
    const result = refineAttempt(dir, "WU003");
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("A12: target in_progress is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success); // selects WU002, now the only ready work unit
    const result = refineAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-TARGET-INELIGIBLE");
  });

  it("A14: target done is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    expect(runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD }).exitCode).toBe(ExitCode.Success);
    const result = refineAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A13: target needs_review is rejected with exit 2", async () => {
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
    const result = refineAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A16: target cancelled is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const state = readState(dir);
    const wu = state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU002");
    wu.status = "cancelled";
    writeState(dir, state);
    const result = refineAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A15: target already replanned is rejected with exit 2", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    expect(refineAttempt(dir, "WU002").exitCode).toBe(ExitCode.Success);
    const result = refineAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("A17: target with a checkpoint on record is rejected with exit 2 even if its status was reset", async () => {
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
    const result = refineAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-TARGET-HAS-HISTORY");
  });

  it("A18: target with an active agent packet is rejected with exit 2", async () => {
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
    const result = refineAttempt(dir, "WU002");
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0]?.id).toBe("PLAN-EXTEND-TARGET-HAS-HISTORY");
  });
});

describe("aiqt plan --extend: deprecated --replace-placeholder alias", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("still refines a target and emits a non-blocking deprecation warning", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU002",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { operation: string; targetWorkUnitId: string };
    expect(data.operation).toBe("refine");
    expect(data.targetWorkUnitId).toBe("WU002");
    expect(result.warnings.some((w) => w.id === "PLAN-EXTEND-DEPRECATED-ALIAS")).toBe(true);
  });
});

describe("aiqt plan --extend: append CLI contract", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("applies a valid append, adding a milestone and work unit, exit 0", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const appendInput = {
      milestones: [{ clientKey: "new-m", title: "New milestone", objective: "New milestone objective." }],
      workUnits: [
        {
          clientKey: "new-wu",
          milestoneClientKey: "new-m",
          title: "Appended work unit",
          objective: "Appended objective.",
          scope: ["Scope"],
          outOfScope: ["Out of scope"],
          acceptanceCriteria: ["Criterion"],
          agentContextRefs: [],
          suggestedFiles: ["src/"],
          validationCommands: ["pnpm test"],
        },
      ],
      dependencies: [],
    };
    const appendPath = join(dir, "append.json");
    writeFileSync(appendPath, JSON.stringify(appendInput));
    const before = readState(dir);

    const result = runPlan(contextFor(dir), { extend: true, fromFile: appendPath });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.action).toBe("plan");
    const data = result.data as { operation: string; addedMilestoneIds: string[]; addedWorkUnitIds: string[] };
    expect(data.operation).toBe("append");
    expect(data.addedMilestoneIds).toHaveLength(1);
    expect(data.addedWorkUnitIds).toHaveLength(1);

    const after = readState(dir);
    expect(after.workGraph.milestones).toHaveLength(before.workGraph.milestones.length + 1);
    expect(after.workGraph.workUnits).toHaveLength(before.workGraph.workUnits.length + 1);
  });

  it("--preview validates and reports the append without writing files or appending runlog events", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const appendPath = join(dir, "append.json");
    writeFileSync(appendPath, JSON.stringify({ milestones: [], workUnits: [], dependencies: [] }));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readRunlogLines(dir).length;

    const result = runPlan(contextFor(dir), { extend: true, fromFile: appendPath, preview: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { preview: boolean; mutationPerformed: boolean; operation: string };
    expect(data.preview).toBe(true);
    expect(data.mutationPerformed).toBe(false);
    expect(data.operation).toBe("append");

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("a simulated persistence failure leaves state.json and runlog.jsonl completely untouched", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const beforeState = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const beforeRunlog = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });

    const appendInput = {
      milestones: [{ clientKey: "new-m", title: "New milestone", objective: "New milestone objective." }],
      workUnits: [
        {
          clientKey: "new-wu",
          milestoneClientKey: "new-m",
          title: "Appended work unit",
          objective: "Appended objective.",
          scope: ["Scope"],
          outOfScope: ["Out of scope"],
          acceptanceCriteria: ["Criterion"],
          agentContextRefs: [],
          suggestedFiles: ["src/"],
          validationCommands: ["pnpm test"],
        },
      ],
      dependencies: [],
    };
    const appendPath = join(dir, "append.json");
    writeFileSync(appendPath, JSON.stringify(appendInput));

    const result = runPlan(contextFor(dir), { extend: true, fromFile: appendPath });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");

    spy.mockRestore();

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforeState);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(beforeRunlog);
  });

  it("still allocates correct, uncorrupted IDs on a subsequent valid append attempt after a persistence failure", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const appendInput = {
      milestones: [{ clientKey: "new-m", title: "New milestone", objective: "New milestone objective." }],
      workUnits: [
        {
          clientKey: "new-wu",
          milestoneClientKey: "new-m",
          title: "Appended work unit",
          objective: "Appended objective.",
          scope: ["Scope"],
          outOfScope: ["Out of scope"],
          acceptanceCriteria: ["Criterion"],
          agentContextRefs: [],
          suggestedFiles: ["src/"],
          validationCommands: ["pnpm test"],
        },
      ],
      dependencies: [],
    };
    const appendPath = join(dir, "append.json");
    writeFileSync(appendPath, JSON.stringify(appendInput));

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });
    const failed = runPlan(contextFor(dir), { extend: true, fromFile: appendPath });
    expect(failed.exitCode).toBe(ExitCode.InvalidInput);
    spy.mockRestore();

    const retried = runPlan(contextFor(dir), { extend: true, fromFile: appendPath });
    expect(retried.exitCode).toBe(ExitCode.Success);
    const data = retried.data as { addedMilestoneIds: string[]; addedWorkUnitIds: string[] };
    expect(data.addedMilestoneIds).toEqual(["M004"]);
    expect(data.addedWorkUnitIds).toEqual(["WU004"]);
  });

  it("appends plan.extended with operation 'append' and no new work_unit.status_changed event", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const linesBefore = readRunlogLines(dir);
    const statusChangedBefore = linesBefore.filter((l) => l.type === "work_unit.status_changed").length;

    const appendPath = join(dir, "append.json");
    writeFileSync(appendPath, JSON.stringify({ milestones: [], workUnits: [], dependencies: [] }));
    runPlan(contextFor(dir), { extend: true, fromFile: appendPath });

    const lines = readRunlogLines(dir);
    const extended = lines.find((l) => l.type === "plan.extended")!;
    expect(extended).toBeDefined();
    expect(extended.data.operation).toBe("append");
    const statusChangedAfter = lines.filter((l) => l.type === "work_unit.status_changed").length;
    expect(statusChangedAfter).toBe(statusChangedBefore);
  });
});
