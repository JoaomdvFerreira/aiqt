import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runNextCancel } from "../../src/cli/commands/next-cancel.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

async function makePlannedProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt next cancel", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runNextCancel(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("returns exit code 2 when there is no current packet to cancel", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const result = runNextCancel(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("returns exit code 2 when a checkpoint already exists for the current packet", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const cpResult = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(cpResult.exitCode).toBe(ExitCode.Success);

    // Nothing is in_progress anymore (checkpoint completed it), so cancel
    // should report "no current packet" (exit 2) rather than crashing.
    const result = runNextCancel(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("restores the work unit to ready, clears current pointers, and restores lastAgentPacket to null", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const packetId = (nextResult.data as { packetId: string }).packetId;

    const runlogBefore = readRunlogLines(dir).length;
    const result = runNextCancel(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");

    const state = readState(dir);
    expect(state.currentWorkUnitId).toBeNull();
    // currentMilestoneId is recomputed from the next ready work unit (same
    // convention aiqt checkpoint uses): with only WU001 in the graph, it
    // becomes ready again after cancel, so currentMilestoneId is its
    // milestone once more, not null.
    expect(state.currentMilestoneId).toBe("M001");
    expect(state.lastAgentPacket).toBeNull();
    expect(state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU001").status).toBe("ready");
    // projectStatus must not stay stuck at "in_progress" once nothing is
    // actually active; it reverts to "planned" (matching aiqt plan's own
    // convention), since ready work remains but nothing is in progress.
    expect(state.projectStatus).toBe("planned");

    const runlogLines = readRunlogLines(dir) as Array<{ type: string; data: Record<string, unknown> }>;
    expect(runlogLines).toHaveLength(runlogBefore + 1);
    const event = runlogLines[runlogLines.length - 1];
    expect(event.type).toBe("packet.cancelled");
    expect(event.data.packetId).toBe(packetId);
    expect(event.data.workUnitId).toBe("WU001");
    expect(event.data.restoredWorkUnitStatus).toBe("ready");
    expect(event.data.previousLastAgentPacketId).toBeNull();
  });

  it("does not delete runlog history, including the original agent_packet.created event", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    runNext(contextFor(dir));
    const runlogBefore = readRunlogLines(dir) as Array<{ type: string }>;
    runNextCancel(contextFor(dir));
    const runlogAfter = readRunlogLines(dir) as Array<{ type: string }>;
    expect(runlogAfter.length).toBe(runlogBefore.length + 1);
    expect(runlogAfter.some((e) => e.type === "agent_packet.created")).toBe(true);
  });

  it("allows aiqt next to select the cancelled work unit again afterward", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    runNext(contextFor(dir));
    const cancelResult = runNextCancel(contextFor(dir));
    expect(cancelResult.exitCode).toBe(ExitCode.Success);

    const secondNext = runNext(contextFor(dir));
    expect(secondNext.exitCode).toBe(ExitCode.Success);
    expect((secondNext.data as { workUnitId: string }).workUnitId).toBe("WU001");
  });
});
