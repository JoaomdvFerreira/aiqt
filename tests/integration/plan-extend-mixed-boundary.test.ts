import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

/**
 * M17-RC1 §11: a refinement target work unit with all boundary dependency
 * types at once -- incoming blocks (from WU-IN-B), incoming requires (from
 * WU-IN-R), outgoing blocks (to WU-OUT-B), outgoing requires (to
 * WU-OUT-R), and a relates_to relationship (from WU-REL) that must never be
 * copied or affect readiness.
 */
const MIXED_BOUNDARY_PLAN = {
  milestones: [
    { clientKey: "m-in", title: "Predecessors", objective: "Predecessor milestone." },
    { clientKey: "m-target", title: "Refinable future work", objective: "Refinement target milestone." },
    { clientKey: "m-out", title: "Downstream", objective: "Downstream milestone." },
  ],
  workUnits: [
    {
      clientKey: "wu-in-b",
      milestoneClientKey: "m-in",
      title: "Incoming blocks predecessor",
      objective: "Predecessor via blocks.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu-in-r",
      milestoneClientKey: "m-in",
      title: "Incoming requires predecessor",
      objective: "Predecessor via requires.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu-rel",
      milestoneClientKey: "m-in",
      title: "Relates-to peer",
      objective: "Non-blocking relationship peer.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu-target",
      milestoneClientKey: "m-target",
      title: "Mixed boundary refinement target",
      objective: "Refinement target with every boundary dependency type.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu-out-b",
      milestoneClientKey: "m-out",
      title: "Outgoing blocks downstream",
      objective: "Downstream via blocks.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu-out-r",
      milestoneClientKey: "m-out",
      title: "Outgoing requires downstream",
      objective: "Downstream via requires.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [
    { fromClientKey: "wu-in-b", toClientKey: "wu-target", type: "blocks" },
    { fromClientKey: "wu-in-r", toClientKey: "wu-target", type: "requires" },
    { fromClientKey: "wu-rel", toClientKey: "wu-target", type: "relates_to" },
    { fromClientKey: "wu-target", toClientKey: "wu-out-b", type: "blocks" },
    { fromClientKey: "wu-target", toClientKey: "wu-out-r", type: "requires" },
  ],
};

const REFINEMENT_INPUT = {
  extension: {
    entryWorkUnitClientKeys: ["e1"],
    exitWorkUnitClientKeys: ["e1"],
    reason: "Detail the mixed-boundary refinement target.",
  },
  milestones: [{ clientKey: "c-m", title: "Detail", objective: "Detailed replacement work." }],
  workUnits: [
    {
      clientKey: "e1",
      milestoneClientKey: "c-m",
      title: "Entry/exit unit",
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

async function makeMixedBoundaryProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(MIXED_BOUNDARY_PLAN));
  expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
}

describe("M17-RC1 §11: mixed boundary-dependency fixture", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("starts with the refinement target blocked by its incoming blocks+requires dependencies", async () => {
    dir = makeTempDir();
    await makeMixedBoundaryProject(dir);
    const state = readState(dir);
    const target = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Mixed boundary refinement target",
    );
    // Predecessors are not done yet, so the refinement target is blocked.
    expect(target.status).toBe("planned");
  });

  it("copies incoming blocks and requires to the entry, outgoing blocks and requires from the exit, preserving each type, and never copies relates_to", async () => {
    dir = makeTempDir();
    await makeMixedBoundaryProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));

    const phId = readState(dir).workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Mixed boundary refinement target",
    ).id;

    const result = runPlan(contextFor(dir), { extend: true, refineWorkUnit: phId, fromFile: extPath });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as {
      copiedIncomingDependencyIds: string[];
      copiedOutgoingDependencyIds: string[];
    };
    expect(data.copiedIncomingDependencyIds).toHaveLength(2);
    expect(data.copiedOutgoingDependencyIds).toHaveLength(2);

    const state = readState(dir);
    const entryExitId = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Entry/exit unit",
    ).id;

    const incoming = data.copiedIncomingDependencyIds.map((id) =>
      state.workGraph.dependencies.find((d: { id: string }) => d.id === id),
    );
    expect(incoming.map((d: { type: string }) => d.type).sort()).toEqual(["blocks", "requires"]);
    for (const dep of incoming) expect(dep.toId).toBe(entryExitId);

    const outgoing = data.copiedOutgoingDependencyIds.map((id) =>
      state.workGraph.dependencies.find((d: { id: string }) => d.id === id),
    );
    expect(outgoing.map((d: { type: string }) => d.type).sort()).toEqual(["blocks", "requires"]);
    for (const dep of outgoing) expect(dep.fromId).toBe(entryExitId);

    // relates_to is never copied: exactly the 5 original dependencies remain
    // plus the payload's boundary copies (2 incoming + 2 outgoing = 4), no more.
    expect(state.workGraph.dependencies).toHaveLength(5 + 4);
    const relatesTo = state.workGraph.dependencies.filter((d: { type: string }) => d.type === "relates_to");
    expect(relatesTo).toHaveLength(1); // only the original wu-rel -> refinement target relationship.
  });

  it("keeps downstream work blocked until the new exit's copied dependencies are satisfied, unaffected by relates_to", async () => {
    dir = makeTempDir();
    await makeMixedBoundaryProject(dir);
    const extPath = join(dir, "ext.json");
    writeFileSync(extPath, JSON.stringify(REFINEMENT_INPUT));
    const phId = readState(dir).workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Mixed boundary refinement target",
    ).id;
    runPlan(contextFor(dir), { extend: true, refineWorkUnit: phId, fromFile: extPath });

    const state = readState(dir);
    const outB = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Outgoing blocks downstream",
    );
    const outR = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Outgoing requires downstream",
    );
    // Predecessors (wu-in-b/wu-in-r) are not done, so the new entry/exit
    // isn't done either -- downstream must remain blocked.
    expect(outB.status).toBe("planned");
    expect(outR.status).toBe("planned");
  });
});
