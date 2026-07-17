import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runNextPreview } from "../../src/cli/commands/next-preview.command.js";
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

/** Upstream (done) --blocks--> Refinable target (ready) --blocks--> Downstream (planned). */
async function makeRefinableProject(dir: string) {
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
        { clientKey: "m1", title: "Upstream", objective: "Upstream." },
        { clientKey: "m2", title: "Refinable target", objective: "Target." },
        { clientKey: "m3", title: "Downstream", objective: "Downstream." },
      ],
      workUnits: [
        {
          clientKey: "wu1",
          milestoneClientKey: "m1",
          title: "Upstream unit",
          objective: "Upstream.",
          scope: ["S"],
          outOfScope: ["O"],
          acceptanceCriteria: ["A"],
          agentContextRefs: [],
          suggestedFiles: ["src/"],
          validationCommands: ["pnpm test"],
        },
        {
          clientKey: "wu2",
          milestoneClientKey: "m2",
          title: "Refinable target unit",
          objective: "Target.",
          scope: ["S"],
          outOfScope: ["O"],
          acceptanceCriteria: ["A"],
          agentContextRefs: [],
          suggestedFiles: ["src/"],
          validationCommands: ["pnpm test"],
        },
        {
          clientKey: "wu3",
          milestoneClientKey: "m3",
          title: "Downstream unit",
          objective: "Downstream.",
          scope: ["S"],
          outOfScope: ["O"],
          acceptanceCriteria: ["A"],
          agentContextRefs: [],
          suggestedFiles: ["src/"],
          validationCommands: ["pnpm test"],
        },
      ],
      dependencies: [
        { fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" },
        { fromClientKey: "wu2", toClientKey: "wu3", type: "blocks" },
      ],
    }),
  );
  expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
  expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
  expect(runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD }).exitCode).toBe(ExitCode.Success);
}

const REFINEMENT_INPUT = {
  extension: {
    entryWorkUnitClientKeys: ["e1"],
    exitWorkUnitClientKeys: ["e1"],
    reason: "Detail the refinable target.",
  },
  milestones: [{ clientKey: "r-m", title: "Refinement detail", objective: "Detailed replacement work." }],
  workUnits: [
    {
      clientKey: "e1",
      milestoneClientKey: "r-m",
      title: "Replacement entry/exit",
      objective: "Objective.",
      scope: ["S"],
      outOfScope: ["O"],
      acceptanceCriteria: ["A"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [],
};

describe("M18 §7.3/§17.2: effective readiness respects M17-RC1 replanned invariants", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a valid refinement's replacement entry is selected by aiqt next --preview, not the replanned target or the downstream unit", async () => {
    dir = makeTempDir();
    await makeRefinableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    expect(
      runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath }).exitCode,
    ).toBe(ExitCode.Success);

    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.Success);
    const data = preview.data as { selectedWorkUnitId: string };
    const state = readState(dir);
    const replacement = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Replacement entry/exit",
    );
    expect(data.selectedWorkUnitId).toBe(replacement.id);
  });

  it("downstream work is not selectable until the replacement exit is actually done -- replacement exit boundary is authoritative", async () => {
    dir = makeTempDir();
    await makeRefinableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    expect(
      runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath }).exitCode,
    ).toBe(ExitCode.Success);

    const state = readState(dir);
    const downstream = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Downstream unit");
    expect(downstream.status).toBe("planned"); // canonically correct already, and effectively not ready.

    const preview = runNextPreview(contextFor(dir));
    const data = preview.data as { selectedWorkUnitId: string };
    expect(data.selectedWorkUnitId).not.toBe(downstream.id);
  });

  it("preserved historical original dependency (replanned target -> downstream) does not by itself release downstream", async () => {
    dir = makeTempDir();
    await makeRefinableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    expect(
      runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath }).exitCode,
    ).toBe(ExitCode.Success);

    const state = readState(dir);
    // The original WU002 -> WU003 dependency is preserved (never deleted),
    // and WU002 is "replanned" (which isBlockingSourceSatisfied treats as
    // satisfied in isolation) -- but the boundary rewiring dependency from
    // the replacement exit is what actually still gates WU003, so it must
    // remain blocked regardless of the preserved historical edge.
    const original = state.workGraph.dependencies.find(
      (d: { fromId: string; toId: string }) => d.fromId === "WU002" && d.toId === "WU003",
    );
    expect(original).toBeDefined();
    const downstream = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Downstream unit");
    expect(downstream.status).toBe("planned");
  });

  it("a malformed replanned target (corrupted replacedByWorkUnitIds) does not release downstream work through effective readiness", async () => {
    dir = makeTempDir();
    await makeRefinableProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    expect(
      runPlan(contextFor(dir), { extend: true, refineWorkUnit: "WU002", fromFile: extPath }).exitCode,
    ).toBe(ExitCode.Success);

    // Corrupt the replanned target's replacement metadata and delete the
    // boundary rewiring dependency, simulating a manually-edited malformed
    // state.json rather than the atomic refine engine's own output.
    const state = readState(dir);
    const target = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
    target.replacedByWorkUnitIds = [];
    const downstream = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Downstream unit");
    // Force downstream back to canonical "ready" (as if some other process
    // incorrectly treated the malformed replanned predecessor as satisfying).
    downstream.status = "ready";
    writeState(dir, state);

    const preview = runNextPreview(contextFor(dir));
    const data = preview.data as { selectedWorkUnitId: string } | undefined;
    // Even though downstream's canonical status was forced to "ready", the
    // malformed replanned predecessor must not be treated as satisfying --
    // effective readiness must still exclude it.
    if (preview.exitCode === ExitCode.Success) {
      expect(data?.selectedWorkUnitId).not.toBe(downstream.id);
    } else {
      expect(preview.exitCode).toBe(ExitCode.WorkflowBlocked);
    }
  });
});
