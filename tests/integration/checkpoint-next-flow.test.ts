import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");

describe("init -> update -> plan -> next -> checkpoint flow", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("advances the workflow from in_progress to the next action", async () => {
    dir = makeTempDir();
    expect(runInit(contextFor(dir), normalizeInitOptions({})).exitCode).toBe(
      ExitCode.Success,
    );

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
      readFileSync(join(PLAN_FIXTURES, "valid-plan-with-dependencies.json")),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(
      ExitCode.Success,
    );

    const next = runNext(contextFor(dir));
    expect(next.exitCode).toBe(ExitCode.Success);
    expect(next.currentWorkUnitId).toBe("WU001");

    const checkpoint = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(checkpoint.exitCode).toBe(ExitCode.Success);
    expect(checkpoint.currentWorkUnitId).toBeNull();
    expect(checkpoint.nextRecommendedCommand).toBe("aiqt next");

    const status = runStatus(contextFor(dir));
    expect(status.exitCode).toBe(ExitCode.Success);
    expect(status.projectStatus).toBe("in_progress");
    expect(status.currentWorkUnitId).toBeNull();

    // WU002 was unblocked by WU001's completion; a second aiqt next should
    // now select it.
    const secondNext = runNext(contextFor(dir));
    expect(secondNext.exitCode).toBe(ExitCode.Success);
    expect(secondNext.currentWorkUnitId).toBe("WU002");
  });
});
