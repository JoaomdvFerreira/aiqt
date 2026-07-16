import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runNextPreview } from "../../src/cli/commands/next-preview.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { runGraphValidate } from "../../src/cli/commands/graph-validate.command.js";
import { runExport } from "../../src/cli/commands/export.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

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

async function makeExtendedProject(dir: string) {
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

  const extPath = join(dir, "ext.json");
  writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
  const result = runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath });
  expect(result.exitCode).toBe(ExitCode.Success);
}

describe("aiqt plan --extend: workflow continuation after extension", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("A41: aiqt status reflects the extended graph and correct workflow position", async () => {
    dir = makeTempDir();
    await makeExtendedProject(dir);
    const result = runStatus(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { milestoneCount: number; workUnitCount: number };
    expect(data.milestoneCount).toBe(3);
    expect(data.workUnitCount).toBe(3);
  });

  it("A42: aiqt review runs cleanly against the extended graph", async () => {
    dir = makeTempDir();
    await makeExtendedProject(dir);
    const result = runReviewCommand(contextFor(dir, true), {});
    expect(result.exitCode).not.toBe(ExitCode.InvalidInput);
  });

  it("A42: aiqt manage classifies the extended graph as not development-complete", async () => {
    dir = makeTempDir();
    await makeExtendedProject(dir);
    const result = runManage(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { developmentComplete: boolean };
    expect(data.developmentComplete).toBe(false);
  });

  it("A42: aiqt export project-plan renders the replanned target work unit and the new work units", async () => {
    dir = makeTempDir();
    await makeExtendedProject(dir);
    const result = runExport(contextFor(dir), { target: "project-plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const content = readFileSync(join(dir, ".aiqt", "exports", "project-plan.md"), "utf8");
    expect(content).toContain("replanned");
    expect(content).toContain("Replacement entry/exit");
  });

  it("aiqt graph validate --json passes with a structurally sound extended graph", async () => {
    dir = makeTempDir();
    await makeExtendedProject(dir);
    const result = runGraphValidate(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { blockingErrors: unknown[] };
    expect(data.blockingErrors).toHaveLength(0);
  });

  it("A43: aiqt next --preview selects the first new entry work unit", async () => {
    dir = makeTempDir();
    await makeExtendedProject(dir);
    const result = runNextPreview(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { selectedWorkUnitId: string };
    expect(data.selectedWorkUnitId).toBe("WU003");
  });

  it("does not automatically create an agent packet for the extension itself", async () => {
    dir = makeTempDir();
    await makeExtendedProject(dir);
    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    // lastAgentPacket still mirrors the earlier aiqt next call for WU001 --
    // the extension must not overwrite it with a packet for the refined
    // target or any newly added work unit.
    expect(state.lastAgentPacket?.workUnitId).toBe("WU001");
    expect(state.currentWorkUnitId).toBeNull();
  });
});
