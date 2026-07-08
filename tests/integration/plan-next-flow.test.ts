import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "fixtures", "plans");

describe("init -> update -> plan -> status/next flow", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("produces a planned project and an aiqt next recommendation", async () => {
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

    // Before planning, next still recommends aiqt plan.
    expect(runNext(contextFor(dir)).nextRecommendedCommand).toBe("aiqt plan");

    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));
    const planResult = runPlan(contextFor(dir), { fromFile: planPath });
    expect(planResult.exitCode).toBe(ExitCode.Success);

    const status = runStatus(contextFor(dir));
    expect(status.exitCode).toBe(ExitCode.Success);
    expect(status.projectStatus).toBe("planned");
    expect(status.nextRecommendedCommand).toBe("aiqt next");

    const next = runNext(contextFor(dir));
    expect(next.exitCode).toBe(ExitCode.Success);
    expect(next.nextRecommendedCommand).toBe("aiqt next");
    expect(next.currentWorkUnitId).toBeNull();
  });
});
