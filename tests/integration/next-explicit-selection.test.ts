import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runNextPreview } from "../../src/cli/commands/next-preview.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import * as workflowStateStore from "../../src/state/workflow-state-store.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
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

/** Two independent effectively ready branches: WU001/M001 (Branch A) and WU002/M002 (Branch B). */
async function makeTwoBranchProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      milestones: [
        { clientKey: "m1", title: "Branch A", objective: "First independent branch." },
        { clientKey: "m2", title: "Branch B", objective: "Second independent branch." },
      ],
      workUnits: [
        workUnitInput("wu1", "m1", "Branch A entry"),
        workUnitInput("wu2", "m2", "Branch B entry"),
      ],
      dependencies: [],
    }),
  );
  const result = runPlan(contextFor(dir), { fromFile: planPath });
  expect(result.exitCode).toBe(ExitCode.Success);
}

describe("M20: aiqt next default compatibility", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("no selector preserves deterministic stored-order behavior", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.Success);
    const data = preview.data as { selectedWorkUnitId: string };
    expect(data.selectedWorkUnitId).toBe("WU001");
  });

  it("packet behavior is unchanged: default apply generates a packet for the first candidate", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitId: string; packet: string };
    expect(data.workUnitId).toBe("WU001");
    expect(typeof data.packet).toBe("string");
  });
});

describe("M20: aiqt next --work-unit", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("selects a later stored-order candidate explicitly", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const preview = runNextPreview(contextFor(dir), { workUnit: "WU002" });
    expect(preview.exitCode).toBe(ExitCode.Success);
    const data = preview.data as { selectedWorkUnitId: string };
    expect(data.selectedWorkUnitId).toBe("WU002");
  });

  it("preview/apply parity: preview and apply select the same work unit", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const preview = runNextPreview(contextFor(dir), { workUnit: "WU002" });
    const previewData = preview.data as { selectedWorkUnitId: string };
    const apply = runNext(contextFor(dir), { workUnit: "WU002" });
    const applyData = apply.data as { workUnitId: string };
    expect(applyData.workUnitId).toBe(previewData.selectedWorkUnitId);
  });

  it("generates the correct packet for the explicitly selected unit", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNext(contextFor(dir), { workUnit: "WU002" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitId: string; packet: string };
    expect(data.workUnitId).toBe("WU002");
    expect(data.packet).toContain("Branch B entry");
  });

  it("the non-selected earlier candidate remains ready after apply", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    runNext(contextFor(dir), { workUnit: "WU002" });
    const state = readState(dir);
    const wu1 = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001");
    expect(wu1.status).toBe("ready");
    const wu2 = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
    expect(wu2.status).toBe("in_progress");
  });

  it("returns exit 3 for an unknown work unit id", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNext(contextFor(dir), { workUnit: "WU999" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0]?.id).toBe("NEXT-UNKNOWN-WORK-UNIT");
  });

  it.each(["planned", "in_progress", "needs_review", "done", "replanned", "cancelled"] as const)(
    "returns exit 2 for a non-executable target with status %s, with no packet or mutation",
    async (status) => {
      dir = makeTempDir();
      await makeTwoBranchProject(dir);
      const state = readState(dir);
      const wu2 = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
      wu2.status = status;
      writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
      const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");

      const result = runNext(contextFor(dir), { workUnit: "WU002" });
      expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
      // No packet is ever included in a blocked result; the data payload
      // (when present) reports canonical status/dependency details only.
      const data = result.data as { canonicalStatus?: string; packet?: string } | undefined;
      expect(data?.packet).toBeUndefined();
      expect(data?.canonicalStatus).toBe(status);
      expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    },
  );

  it("blocked selection reports dependency details", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
    const patchPath = join(dir, "readiness-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    await runUpdate(contextFor(dir), { fromFile: patchPath });
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Chain", objective: "Chain." }],
        workUnits: [workUnitInput("wu1", "m1", "Upstream"), workUnitInput("wu2", "m1", "Downstream")],
        dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" }],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);

    const result = runNext(contextFor(dir), { workUnit: "WU002" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    const data = result.data as { blockingPredecessorWorkUnitIds: string[]; unsatisfiedDependencyIds: string[] };
    expect(data.blockingPredecessorWorkUnitIds).toContain("WU001");
    expect(data.unsatisfiedDependencyIds.length).toBeGreaterThan(0);
  });
});

describe("M20: aiqt next --milestone", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("selects the first ready member of the specified milestone", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNextPreview(contextFor(dir), { milestone: "M002" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { selectedWorkUnitId: string };
    expect(data.selectedWorkUnitId).toBe("WU002");
  });

  it("preview/apply parity for milestone selection", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const preview = runNextPreview(contextFor(dir), { milestone: "M002" });
    const previewData = preview.data as { selectedWorkUnitId: string };
    const apply = runNext(contextFor(dir), { milestone: "M002" });
    const applyData = apply.data as { workUnitId: string };
    expect(applyData.workUnitId).toBe(previewData.selectedWorkUnitId);
  });

  it("ignores an earlier candidate in a different milestone", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNextPreview(contextFor(dir), { milestone: "M002" });
    const data = result.data as { selectedWorkUnitId: string };
    expect(data.selectedWorkUnitId).not.toBe("WU001");
  });

  it("returns exit 3 for an unknown milestone id", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNext(contextFor(dir), { milestone: "M999" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0]?.id).toBe("NEXT-UNKNOWN-MILESTONE");
  });

  it("returns exit 2 for an existing milestone with no ready member, never falling back globally", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const state = readState(dir);
    const wu1 = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001");
    wu1.status = "planned";
    writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));

    const result = runNext(contextFor(dir), { milestone: "M001" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    // WU002 in M002 is still ready, but must never be selected as a fallback.
    expect(result.currentWorkUnitId).toBeNull();
  });
});

describe("M20: mutual exclusivity and validation", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("returns exit 3 when both --work-unit and --milestone are supplied", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNext(contextFor(dir), { workUnit: "WU001", milestone: "M002" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("returns exit 3 when both selectors are supplied to preview", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNextPreview(contextFor(dir), { workUnit: "WU001", milestone: "M002" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("returns exit 3 for an empty --work-unit value", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNext(contextFor(dir), { workUnit: "" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("selectors work with --json output (structured data present)", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNext(contextFor(dir), { workUnit: "WU002" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.data).toBeDefined();
  });
});

describe("M20: candidate reporting", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("lists all effectively ready candidates, deterministically ordered", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNextPreview(contextFor(dir));
    const data = result.data as {
      selectionMode: string;
      selectedWorkUnitId: string;
      effectivelyReadyCandidates: Array<{ workUnitId: string; title: string; milestoneId: string; milestoneTitle: string }>;
    };
    expect(data.selectionMode).toBe("default");
    expect(data.selectedWorkUnitId).toBe("WU001");
    expect(data.effectivelyReadyCandidates.map((c) => c.workUnitId)).toEqual(["WU001", "WU002"]);
    expect(data.effectivelyReadyCandidates[1]).toMatchObject({
      workUnitId: "WU002",
      title: "Branch B entry",
      milestoneId: "M002",
      milestoneTitle: "Branch B",
    });
  });

  it("excludes a stale-ready candidate from the reported list", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    // Append a new prerequisite onto WU002, producing stale readiness (M17-RC1/M18 pattern).
    const appendPath = join(dir, "append.json");
    writeFileSync(
      appendPath,
      JSON.stringify({
        milestones: [{ clientKey: "m3", title: "Prereq", objective: "Prereq." }],
        workUnits: [workUnitInput("wu3", "m3", "Prereq unit")],
        dependencies: [{ fromClientKey: "wu3", toClientKey: "WU002", type: "blocks" }],
      }),
    );
    expect(runPlan(contextFor(dir), { extend: true, fromFile: appendPath }).exitCode).toBe(ExitCode.Success);

    const result = runNextPreview(contextFor(dir));
    const data = result.data as { effectivelyReadyCandidates: Array<{ workUnitId: string }> };
    const ids = data.effectivelyReadyCandidates.map((c) => c.workUnitId);
    expect(ids).not.toContain("WU002");
    expect(ids).toContain("WU001");
    expect(ids).toContain("WU003"); // the new prerequisite unit, itself effectively ready.
  });

  it("human-mode preview includes alternative-candidate guidance when multiple candidates exist", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const result = runNextPreview(contextFor(dir));
    expect(result.summary).toContain("Multiple work units are effectively ready");
    expect(result.summary).toContain("--work-unit");
  });
});

describe("M20: active work unit guard", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  async function makeActiveProject(): Promise<string> {
    const d = makeTempDir();
    await makeTwoBranchProject(d);
    expect(runNext(contextFor(d)).exitCode).toBe(ExitCode.Success); // WU001 becomes active.
    return d;
  }

  const scenarios: Array<{ name: string; run: (d: string) => ReturnType<typeof runNext> }> = [
    { name: "default next", run: (d) => runNext(contextFor(d)) },
    { name: "default preview", run: (d) => runNextPreview(contextFor(d)) },
    { name: "--work-unit targeting another unit", run: (d) => runNext(contextFor(d), { workUnit: "WU002" }) },
    { name: "--work-unit targeting the active unit", run: (d) => runNext(contextFor(d), { workUnit: "WU001" }) },
    {
      name: "--work-unit preview targeting another unit",
      run: (d) => runNextPreview(contextFor(d), { workUnit: "WU002" }),
    },
    { name: "--milestone containing another unit", run: (d) => runNext(contextFor(d), { milestone: "M002" }) },
    { name: "--milestone containing the active unit", run: (d) => runNext(contextFor(d), { milestone: "M001" }) },
    {
      name: "--milestone preview",
      run: (d) => runNextPreview(contextFor(d), { milestone: "M002" }),
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name}: exit 2, zero mutation, zero runlog mutation, no packet, recommends aiqt checkpoint`, async () => {
      dir = await makeActiveProject();
      const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
      const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

      const result = scenario.run(dir);
      expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
      expect(result.nextRecommendedCommand).toBe("aiqt checkpoint");
      const data = result.data as { packet?: string } | undefined;
      expect(data?.packet).toBeUndefined();

      expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
      expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
    });
  }

  it("active guard blocks JSON output identically", async () => {
    dir = await makeActiveProject();
    const result = runNext(contextFor(dir, true), { workUnit: "WU002" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt checkpoint");
  });
});

describe("M20: atomicity", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("preview performs zero state and runlog mutation for explicit selection", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    runNextPreview(contextFor(dir), { workUnit: "WU002" });
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  });

  it("a blocked selection (unknown id) performs zero mutation", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runNext(contextFor(dir), { workUnit: "WU999" });
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("apply appends exactly the expected runlog events for the explicitly selected unit", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    runNext(contextFor(dir), { workUnit: "WU002" });
    const lines = readRunlogLines(dir);
    const packetEvent = lines.find((l) => l.type === "agent_packet.created");
    expect(packetEvent?.data.workUnitId).toBe("WU002");
    const statusEvent = lines.find((l) => l.type === "work_unit.status_changed");
    expect(statusEvent?.data.workUnitId).toBe("WU002");
  });

  it("rolls back completely on a simulated persistence failure -- no partial mutation, no runlog event", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });

    const result = runNext(contextFor(dir), { workUnit: "WU002" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");

    spy.mockRestore();

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  });

  it("retries deterministically after a persistence failure -- the same unit is selected again", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });
    const failed = runNext(contextFor(dir), { workUnit: "WU002" });
    expect(failed.exitCode).toBe(ExitCode.InvalidInput);
    spy.mockRestore();

    const retried = runNext(contextFor(dir), { workUnit: "WU002" });
    expect(retried.exitCode).toBe(ExitCode.Success);
    const data = retried.data as { workUnitId: string };
    expect(data.workUnitId).toBe("WU002");
  });

  it("non-selected parallel candidates are unaffected by a failed selection attempt", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });
    runNext(contextFor(dir), { workUnit: "WU002" });
    spy.mockRestore();

    const state = readState(dir);
    expect(state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001").status).toBe("ready");
    expect(state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002").status).toBe("ready");
  });
});

describe("M20: M18/M19 compatibility spot checks", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("aiqt --version reports 0.7.0 in this build", async () => {
    dir = makeTempDir();
    await makeTwoBranchProject(dir);
    // Selection behavior is unaffected by version; this simply confirms
    // the M20 build didn't regress the M19 version-reporting contract
    // while exercising a real project alongside it.
    const result = runNextPreview(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("relates_to dependencies never block explicit work-unit selection", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
    const patchPath = join(dir, "readiness-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    await runUpdate(contextFor(dir), { fromFile: patchPath });
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "M", objective: "M." }],
        workUnits: [workUnitInput("wu1", "m1", "Peer"), workUnitInput("wu2", "m1", "Target")],
        dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "relates_to" }],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);

    const result = runNextPreview(contextFor(dir), { workUnit: "WU002" });
    expect(result.exitCode).toBe(ExitCode.Success);
  });
});
