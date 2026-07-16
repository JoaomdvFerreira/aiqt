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
  ],
  dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" }],
};

const REFINEMENT_INPUT = {
  extension: {
    entryWorkUnitClientKeys: ["e1"],
    exitWorkUnitClientKeys: ["e1"],
    reason: "Detail the refinable future work.",
  },
  milestones: [{ clientKey: "r-m", title: "Refinement detail", objective: "Detailed replacement work." }],
  workUnits: [
    {
      clientKey: "e1",
      milestoneClientKey: "r-m",
      title: "Replacement entry/exit",
      objective: "Entry/exit objective.",
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

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

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
  expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
  expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
  expect(runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD }).exitCode).toBe(ExitCode.Success);
}

describe("aiqt plan --extend: A39 atomicity under a simulated persistence failure", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("leaves state.json, runlog.jsonl, and the target work unit status completely untouched", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const beforeState = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const beforeRunlog = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });

    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU002",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");

    spy.mockRestore();

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforeState);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(beforeRunlog);
    expect(readState(dir).workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002").status).toBe(
      "ready",
    );
  });

  it("still allocates correct, uncorrupted IDs on a subsequent valid extension attempt", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const spy = vi
      .spyOn(workflowStateStore, "writeStateModel")
      .mockImplementation(() => {
        throw new Error("Simulated persistence failure");
      });
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const failed = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU002",
      fromFile: extPath,
    });
    expect(failed.exitCode).toBe(ExitCode.InvalidInput);
    spy.mockRestore();

    const retried = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: "WU002",
      fromFile: extPath,
    });
    expect(retried.exitCode).toBe(ExitCode.Success);
    const data = retried.data as { addedMilestoneIds: string[]; addedWorkUnitIds: string[] };
    expect(data.addedMilestoneIds).toEqual(["M003"]);
    expect(data.addedWorkUnitIds).toEqual(["WU003"]);
  });
});
