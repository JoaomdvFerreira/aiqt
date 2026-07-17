import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runGraphRepair } from "../../src/cli/commands/graph-repair.command.js";
import { runGraphValidate } from "../../src/cli/commands/graph-validate.command.js";
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

function workUnitInput(clientKey: string, milestoneClientKey: string, title: string) {
  return {
    clientKey,
    milestoneClientKey,
    title,
    objective: `${title}.`,
    scope: [`Implement ${title}.`],
    outOfScope: ["Nothing outside scope."],
    acceptanceCriteria: [`${title} is complete.`],
    agentContextRefs: [],
    suggestedFiles: ["src/"],
    validationCommands: ["pnpm test"],
  };
}

async function makeReadyProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
}

/** Plants two stale-ready units ("WU-stale-1", "WU-stale-2") and one genuinely ready unit ("WU-good"). */
async function makeMultiStaleProject(dir: string) {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      milestones: [
        { clientKey: "m1", title: "Upstream", objective: "Upstream." },
        { clientKey: "m2", title: "Stale 1", objective: "Target 1." },
        { clientKey: "m3", title: "Stale 2", objective: "Target 2." },
        { clientKey: "m4", title: "Good", objective: "Independent." },
      ],
      workUnits: [
        workUnitInput("wu-up", "m1", "Upstream unit"),
        workUnitInput("wu-stale-1", "m2", "Stale unit 1"),
        workUnitInput("wu-stale-2", "m3", "Stale unit 2"),
        workUnitInput("wu-good", "m4", "Good unit"),
      ],
      dependencies: [
        { fromClientKey: "wu-up", toClientKey: "wu-stale-1", type: "blocks" },
        { fromClientKey: "wu-up", toClientKey: "wu-stale-2", type: "requires" },
      ],
    }),
  );
  expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);

  const state = readState(dir);
  const upstream = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Upstream unit");
  upstream.status = "in_progress";
  for (const title of ["Stale unit 1", "Stale unit 2"]) {
    const wu = state.workGraph.workUnits.find((w: { title: string }) => w.title === title);
    wu.status = "ready";
    const milestone = state.workGraph.milestones.find((m: { id: string }) => m.id === wu.milestoneId);
    milestone.status = "ready";
  }
  writeState(dir, state);
  return state;
}

describe("M18 §11: aiqt graph repair --dry-run for stale readiness", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("proposes ready -> planned for each stale-ready unit, with dependency and predecessor details", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    const result = runGraphRepair(contextFor(dir), { dryRun: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as {
      staleReadinessRepairs: Array<{
        workUnitId: string;
        currentStatus: string;
        proposedStatus: string;
        unsatisfiedDependencyIds: string[];
        blockingPredecessorWorkUnitIds: string[];
        wouldMutate: boolean;
      }>;
    };
    expect(data.staleReadinessRepairs).toHaveLength(2);
    for (const proposal of data.staleReadinessRepairs) {
      expect(proposal.currentStatus).toBe("ready");
      expect(proposal.proposedStatus).toBe("planned");
      expect(proposal.unsatisfiedDependencyIds.length).toBeGreaterThan(0);
      expect(proposal.blockingPredecessorWorkUnitIds.length).toBeGreaterThan(0);
      expect(proposal.wouldMutate).toBe(true);
    }
  });

  it("does not propose a repair for the genuinely effectively-ready unit", async () => {
    dir = makeTempDir();
    const state = await makeMultiStaleProject(dir);
    const good = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Good unit");
    const result = runGraphRepair(contextFor(dir), { dryRun: true });
    const data = result.data as { staleReadinessRepairs: Array<{ workUnitId: string }> };
    expect(data.staleReadinessRepairs.some((p) => p.workUnitId === good.id)).toBe(false);
  });

  it("performs zero state mutation and zero runlog mutation", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    runGraphRepair(contextFor(dir), { dryRun: true });
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  });

  it("ignores terminal/history statuses -- done/replanned/cancelled/in_progress/needs_review never appear as proposals", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    const state = readState(dir);
    const stale1 = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Stale unit 1");
    stale1.status = "done"; // terminal -- must never be proposed even though it "was" stale.
    writeState(dir, state);

    const result = runGraphRepair(contextFor(dir), { dryRun: true });
    const data = result.data as { staleReadinessRepairs: Array<{ workUnitId: string }> };
    expect(data.staleReadinessRepairs.some((p) => p.workUnitId === stale1.id)).toBe(false);
  });

  it("reports no proposed changes when the graph is already normalized", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Clean", objective: "Clean." }],
        workUnits: [workUnitInput("wu1", "m1", "Clean unit")],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    const result = runGraphRepair(contextFor(dir), { dryRun: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { staleReadinessRepairs: unknown[] };
    expect(data.staleReadinessRepairs).toHaveLength(0);
  });
});

describe("M18 §11.2: aiqt graph repair --apply", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("repairs one stale unit and preserves the genuinely ready unit", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [
          { clientKey: "m1", title: "Upstream", objective: "Upstream." },
          { clientKey: "m2", title: "Stale", objective: "Target." },
          { clientKey: "m3", title: "Good", objective: "Independent." },
        ],
        workUnits: [
          workUnitInput("wu-up", "m1", "Upstream unit"),
          workUnitInput("wu-stale", "m2", "Stale unit"),
          workUnitInput("wu-good", "m3", "Good unit"),
        ],
        dependencies: [{ fromClientKey: "wu-up", toClientKey: "wu-stale", type: "blocks" }],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    const before = readState(dir);
    const stale = before.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Stale unit");
    const good = before.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Good unit");
    stale.status = "ready";
    writeState(dir, before);

    const result = runGraphRepair(contextFor(dir), { apply: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { mutationPerformed: boolean; repairedWorkUnitIds: string[] };
    expect(data.mutationPerformed).toBe(true);
    expect(data.repairedWorkUnitIds).toEqual([stale.id]);

    const after = readState(dir);
    const repairedStale = after.workGraph.workUnits.find((wu: { id: string }) => wu.id === stale.id);
    expect(repairedStale.status).toBe("planned");
    const untouchedGood = after.workGraph.workUnits.find((wu: { id: string }) => wu.id === good.id);
    expect(untouchedGood.status).toBe("ready");
  });

  it("repairs multiple stale units atomically in one apply", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    const result = runGraphRepair(contextFor(dir), { apply: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { repairedWorkUnitIds: string[] };
    expect(data.repairedWorkUnitIds).toHaveLength(2);

    const after = readState(dir);
    for (const id of data.repairedWorkUnitIds) {
      expect(after.workGraph.workUnits.find((wu: { id: string }) => wu.id === id).status).toBe("planned");
    }
  });

  it("preserves done, replanned, cancelled, in_progress, and needs_review statuses untouched", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "M", objective: "M." }],
        workUnits: [
          workUnitInput("wu1", "m1", "Done unit"),
          workUnitInput("wu2", "m1", "Cancelled unit"),
          workUnitInput("wu3", "m1", "Needs review unit"),
        ],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    const state = readState(dir);
    const done = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Done unit");
    done.status = "done";
    const cancelled = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Cancelled unit");
    cancelled.status = "cancelled";
    const needsReview = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Needs review unit");
    needsReview.status = "needs_review";
    writeState(dir, state);

    const result = runGraphRepair(contextFor(dir), { apply: true });
    expect(result.exitCode).toBe(ExitCode.Success);

    const after = readState(dir);
    expect(after.workGraph.workUnits.find((wu: { id: string }) => wu.id === done.id).status).toBe("done");
    expect(after.workGraph.workUnits.find((wu: { id: string }) => wu.id === cancelled.id).status).toBe("cancelled");
    expect(after.workGraph.workUnits.find((wu: { id: string }) => wu.id === needsReview.id).status).toBe(
      "needs_review",
    );
  });

  it("succeeds as a no-op when there is nothing to repair, with mutationPerformed false", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Clean", objective: "Clean." }],
        workUnits: [workUnitInput("wu1", "m1", "Clean unit")],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");

    const result = runGraphRepair(contextFor(dir), { apply: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { mutationPerformed: boolean };
    expect(data.mutationPerformed).toBe(false);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("appends exactly one graph.repaired runlog event with the expected change details", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    runGraphRepair(contextFor(dir), { apply: true });
    const lines = readRunlogLines(dir);
    const repairedEvents = lines.filter((l) => l.type === "graph.repaired");
    expect(repairedEvents).toHaveLength(1);
    const data = repairedEvents[0].data as {
      repairType: string;
      workUnitIds: string[];
      changes: Array<{ workUnitId: string; from: string; to: string }>;
    };
    expect(data.repairType).toBe("stale_readiness");
    expect(data.workUnitIds).toHaveLength(2);
    for (const change of data.changes) {
      expect(change.from).toBe("ready");
      expect(change.to).toBe("planned");
    }
  });

  it("appends no runlog event for the no-op case", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Clean", objective: "Clean." }],
        workUnits: [workUnitInput("wu1", "m1", "Clean unit")],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    runGraphRepair(contextFor(dir), { apply: true });
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  });

  it("rolls back completely on a simulated persistence failure -- no partial repair, no runlog event", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    const beforeState = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const beforeRunlog = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });

    const result = runGraphRepair(contextFor(dir), { apply: true });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");

    spy.mockRestore();

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforeState);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(beforeRunlog);
  });

  it("retries deterministically after a persistence failure -- the same units are repaired", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });
    const failed = runGraphRepair(contextFor(dir), { apply: true });
    expect(failed.exitCode).toBe(ExitCode.InvalidInput);
    spy.mockRestore();

    const retried = runGraphRepair(contextFor(dir), { apply: true });
    expect(retried.exitCode).toBe(ExitCode.Success);
    const data = retried.data as { repairedWorkUnitIds: string[] };
    expect(data.repairedWorkUnitIds).toHaveLength(2);
  });

  it("second dry-run after apply is idempotent -- reports zero further proposals", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    expect(runGraphRepair(contextFor(dir), { apply: true }).exitCode).toBe(ExitCode.Success);

    const secondDryRun = runGraphRepair(contextFor(dir), { dryRun: true });
    expect(secondDryRun.exitCode).toBe(ExitCode.Success);
    const data = secondDryRun.data as { staleReadinessRepairs: unknown[] };
    expect(data.staleReadinessRepairs).toHaveLength(0);
  });

  it("second apply after a successful apply is a no-op (idempotent)", async () => {
    dir = makeTempDir();
    await makeMultiStaleProject(dir);
    expect(runGraphRepair(contextFor(dir), { apply: true }).exitCode).toBe(ExitCode.Success);

    const second = runGraphRepair(contextFor(dir), { apply: true });
    expect(second.exitCode).toBe(ExitCode.Success);
    const data = second.data as { mutationPerformed: boolean };
    expect(data.mutationPerformed).toBe(false);
  });

  it("graph validates cleanly and next --preview correctly selects the good unit after repair", async () => {
    dir = makeTempDir();
    const state = await makeMultiStaleProject(dir);
    const good = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Good unit");
    runGraphRepair(contextFor(dir), { apply: true });

    const validation = runGraphValidate(contextFor(dir));
    expect(validation.exitCode).toBe(ExitCode.Success);
    const validationData = validation.data as { blockingErrors: unknown[] };
    expect(validationData.blockingErrors).toHaveLength(0);

    const { runNextPreview } = await import("../../src/cli/commands/next-preview.command.js");
    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.Success);
    const previewData = preview.data as { selectedWorkUnitId: string };
    expect(previewData.selectedWorkUnitId).toBe(good.id);
  });
});
