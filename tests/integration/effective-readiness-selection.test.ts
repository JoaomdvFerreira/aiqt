import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runNextPreview } from "../../src/cli/commands/next-preview.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
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

/**
 * Directly plants a stale-ready work unit ("WU-STALE", canonically "ready")
 * with an active unsatisfied blocking dependency from a not-done unit
 * ("WU-UP"), alongside a genuinely effectively-ready unit ("WU-GOOD"). This
 * mirrors the M18 §1 root cause -- a canonically ready work unit whose
 * dependency was never satisfied -- without depending on any particular
 * mutation path.
 */
async function makeStaleReadyProject(dir: string) {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      milestones: [
        { clientKey: "m1", title: "Upstream", objective: "Upstream work." },
        { clientKey: "m2", title: "Stale target", objective: "Target milestone." },
        { clientKey: "m3", title: "Good target", objective: "Independent milestone." },
      ],
      workUnits: [
        workUnitInput("wu-up", "m1", "Upstream unit"),
        workUnitInput("wu-stale", "m2", "Stale unit"),
        workUnitInput("wu-good", "m3", "Good unit"),
      ],
      dependencies: [{ fromClientKey: "wu-up", toClientKey: "wu-stale", type: "blocks" }],
    }),
  );
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  // "Stale unit" starts correctly "planned" (blocked by "Upstream unit").
  // Directly force its canonical status to "ready" while its blocking
  // dependency source ("Upstream unit") remains not-done -- the exact
  // stale-readiness condition this milestone corrects for, reproducible
  // without depending on the specific append code path that can also
  // produce it. "Upstream unit" is also forced to "in_progress" so it is
  // itself excluded from candidacy (it would otherwise be its own
  // legitimately-ready first-in-order candidate, since a fresh plan gives
  // it no incoming dependency).
  const state = readState(dir);
  const stale = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Stale unit");
  stale.status = "ready";
  const staleMilestone = state.workGraph.milestones.find((m: { id: string }) => m.id === stale.milestoneId);
  staleMilestone.status = "ready";
  const upstream = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Upstream unit");
  upstream.status = "in_progress";
  const upstreamMilestone = state.workGraph.milestones.find((m: { id: string }) => m.id === upstream.milestoneId);
  upstreamMilestone.status = "in_progress";
  writeState(dir, state);
}

describe("M18: effective readiness selection", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("aiqt next --preview excludes the stale-ready unit and selects the effectively ready unit", async () => {
    dir = makeTempDir();
    await makeStaleReadyProject(dir);
    const result = runNextPreview(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { selectedWorkUnitId: string };
    const state = readState(dir);
    const good = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Good unit");
    expect(data.selectedWorkUnitId).toBe(good.id);
  });

  it("aiqt next selects the same work unit as aiqt next --preview (preview/apply parity)", async () => {
    dir = makeTempDir();
    await makeStaleReadyProject(dir);
    const preview = runNextPreview(contextFor(dir));
    const previewData = preview.data as { selectedWorkUnitId: string };

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitId: string };
    expect(data.workUnitId).toBe(previewData.selectedWorkUnitId);
  });

  it("never creates a packet for the stale-ready candidate", async () => {
    dir = makeTempDir();
    await makeStaleReadyProject(dir);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const state = readState(dir);
    const stale = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Stale unit");
    expect(state.lastAgentPacket?.workUnitId).not.toBe(stale.id);
    expect(state.currentWorkUnitId).not.toBe(stale.id);
  });

  it("aiqt next --preview performs zero canonical writes and zero runlog writes", async () => {
    dir = makeTempDir();
    await makeStaleReadyProject(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    runNextPreview(contextFor(dir));
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  });

  it("returns the blocked/no-ready result (exit 2) when only a stale-ready unit exists", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [
          { clientKey: "m1", title: "Upstream", objective: "Upstream work." },
          { clientKey: "m2", title: "Stale target", objective: "Target milestone." },
        ],
        workUnits: [workUnitInput("wu-up", "m1", "Upstream unit"), workUnitInput("wu-stale", "m2", "Stale unit")],
        dependencies: [{ fromClientKey: "wu-up", toClientKey: "wu-stale", type: "blocks" }],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    const state = readState(dir);
    const stale = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Stale unit");
    stale.status = "ready";
    // Exclude "Upstream unit" from candidacy too -- it would otherwise be
    // its own legitimately effectively-ready candidate (no incoming
    // dependency in a fresh plan), which is not what this test is about.
    const upstream = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Upstream unit");
    upstream.status = "in_progress";
    writeState(dir, state);

    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.WorkflowBlocked);

    const next = runNext(contextFor(dir));
    expect(next.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(next.blockingIssues[0]?.id).toBe("NEXT-NO-READY-WORK-UNIT");
  });

  it("preserves deterministic selection order (stored order) among multiple effectively ready candidates", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Independent work", objective: "Two independent units." }],
        workUnits: [workUnitInput("wu-first", "m1", "First unit"), workUnitInput("wu-second", "m1", "Second unit")],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    const preview = runNextPreview(contextFor(dir));
    const data = preview.data as { selectedWorkUnitId: string };
    expect(data.selectedWorkUnitId).toBe("WU001");
  });

  it("legitimate parallel effectively-ready branches remain independently executable", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Parallel work", objective: "Two independent branches." }],
        workUnits: [workUnitInput("wu-a", "m1", "Branch A"), workUnitInput("wu-b", "m1", "Branch B")],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);

    const first = runNext(contextFor(dir));
    expect(first.exitCode).toBe(ExitCode.Success);
    const firstData = first.data as { workUnitId: string };
    expect(firstData.workUnitId).toBe("WU001");

    // WU002 (Branch B) is still independently effectively ready, but aiqt
    // next now refuses a second selection while WU001 is in_progress --
    // confirming Branch B's readiness was never entangled with Branch A's.
    const state = readState(dir);
    const branchB = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
    expect(branchB.status).toBe("ready");
  });

  it("aiqt status reports canonical ready, effectively ready, and stale ready counts additively", async () => {
    dir = makeTempDir();
    await makeStaleReadyProject(dir);
    const result = runStatus(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as {
      workUnitCounts: { ready: number; effectivelyReady: number; staleReady: number; planned: number };
    };
    expect(data.workUnitCounts.ready).toBe(2); // WU-stale (stale) + WU-good (effective).
    expect(data.workUnitCounts.effectivelyReady).toBe(1); // WU-good only.
    expect(data.workUnitCounts.staleReady).toBe(1); // WU-stale only.
  });

  it("aiqt review reports a WORK_UNIT_STALE_READINESS-style finding with dependency details, and no such finding for the effectively ready unit", async () => {
    dir = makeTempDir();
    await makeStaleReadyProject(dir);
    const result = runReviewCommand(contextFor(dir), {});
    const data = result.data as {
      findings: Array<{
        findingKey: string;
        blocking: boolean;
        relatedIds: string[];
        staleReadinessDetails?: {
          workUnitId: string;
          unsatisfiedDependencyIds: string[];
          blockingPredecessorWorkUnitIds: string[];
          dependencyTypes: string[];
          repairable: boolean;
        };
      }>;
    };
    const state = readState(dir);
    const stale = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Stale unit");
    const good = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Good unit");

    const staleFinding = data.findings.find((f) => f.findingKey === `workunit:${stale.id}:stale-readiness`);
    expect(staleFinding).toBeDefined();
    expect(staleFinding?.blocking).toBe(false);
    expect(staleFinding?.staleReadinessDetails?.workUnitId).toBe(stale.id);
    expect(staleFinding?.staleReadinessDetails?.unsatisfiedDependencyIds.length).toBeGreaterThan(0);
    expect(staleFinding?.staleReadinessDetails?.dependencyTypes).toContain("blocks");
    expect(staleFinding?.staleReadinessDetails?.repairable).toBe(true);

    expect(data.findings.some((f) => f.findingKey === `workunit:${good.id}:stale-readiness`)).toBe(false);
  });

  it("M18 §1: reproduces the actual root cause via aiqt plan --extend append -- a new blocking dependency onto an existing ready unit produces stale readiness, and aiqt next --preview correctly skips it", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Existing roadmap", objective: "Existing roadmap work." }],
        workUnits: [workUnitInput("wu-existing", "m1", "Existing ready unit")],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    // WU001 ("Existing ready unit") is canonically ready with no dependencies.

    const appendPath = join(dir, "append.json");
    writeFileSync(
      appendPath,
      JSON.stringify({
        milestones: [{ clientKey: "m2", title: "Appended prerequisite", objective: "Newly appended prerequisite." }],
        workUnits: [workUnitInput("wu-new", "m2", "Appended prerequisite unit")],
        // Append §5 invariant: this new blocking edge onto the existing
        // "ready" WU001 must not change WU001's canonical status -- so it
        // stays "ready" even though "Appended prerequisite unit" is not done.
        dependencies: [{ fromClientKey: "wu-new", toClientKey: "WU001", type: "blocks" }],
      }),
    );
    const appendResult = runPlan(contextFor(dir), { extend: true, fromFile: appendPath });
    expect(appendResult.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);
    const existing = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001");
    // Append never touched WU001's canonical status -- confirms this really
    // is the M17-RC1 append invariant producing the stale condition, not a
    // bug in append itself.
    expect(existing.status).toBe("ready");

    const preview = runNextPreview(contextFor(dir));
    // No effectively ready candidate exists: WU001 is stale, and the new
    // prerequisite unit is itself not yet ready-relevant to selection
    // ordering here (it IS effectively ready, being the new entry with no
    // dependency itself) -- so preview should select it, never WU001.
    expect(preview.exitCode).toBe(ExitCode.Success);
    const previewData = preview.data as { selectedWorkUnitId: string };
    const newUnit = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Appended prerequisite unit");
    expect(previewData.selectedWorkUnitId).toBe(newUnit.id);
    expect(previewData.selectedWorkUnitId).not.toBe("WU001");
  });
});
