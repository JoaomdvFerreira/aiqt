import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runNextPreview } from "../../src/cli/commands/next-preview.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

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

describe("aiqt next --preview", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runNextPreview(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("returns exit code 2 when no work graph exists", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runNextPreview(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("returns exit code 2 when no ready work unit exists (project in review)", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    // Consume the only ready unit via the real aiqt next, so nothing is ready.
    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    // Cancel is out of scope here; directly assert preview blocks once
    // in-progress, matching aiqt next's own gate.
    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("produces the same selected work unit that aiqt next would select, without mutating state", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const stateBefore = readState(dir);
    const runlogBefore = readRunlogLines(dir).length;

    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.Success);
    const previewData = preview.data as {
      mutation: boolean;
      selectedWorkUnitId: string;
      packetGenerationAllowed: boolean;
    };
    expect(previewData.mutation).toBe(false);
    expect(previewData.selectedWorkUnitId).toBe("WU001");
    expect(previewData.packetGenerationAllowed).toBe(true);

    // State and runlog are untouched by the preview.
    expect(readState(dir)).toEqual(stateBefore);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);

    // The real aiqt next selects the identical work unit.
    const real = runNext(contextFor(dir));
    expect(real.exitCode).toBe(ExitCode.Success);
    expect((real.data as { workUnitId: string }).workUnitId).toBe(previewData.selectedWorkUnitId);
  });

  it("does not set currentWorkUnitId or lastAgentPacket, and leaves currentMilestoneId untouched", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    // currentMilestoneId is already set to the first ready unit's milestone
    // by aiqt plan itself; preview must leave it exactly as-is.
    const before = readState(dir);
    runNextPreview(contextFor(dir));
    const state = readState(dir);
    expect(state.currentWorkUnitId).toBeNull();
    expect(state.currentMilestoneId).toBe(before.currentMilestoneId);
    expect(state.lastAgentPacket).toBeNull();
  });
});
