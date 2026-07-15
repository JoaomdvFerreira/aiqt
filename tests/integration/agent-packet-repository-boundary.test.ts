import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

describe("aiqt next: M15-RC1 Source Control Expectations includes the Repository Boundary Rule (F063)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("renders the Repository Boundary Rule inside Source Control Expectations", async () => {
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
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    const planResult = runPlan(contextFor(dir), { fromFile: planPath });
    expect(planResult.exitCode).toBe(ExitCode.Success);

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { packet: string };

    const sourceControlIndex = data.packet.indexOf("## Source Control Expectations");
    const boundaryIndex = data.packet.indexOf("Repository Boundary Rule:");
    const requiredOutputIndex = data.packet.indexOf("## Required Agent Output");
    expect(sourceControlIndex).toBeGreaterThan(-1);
    expect(boundaryIndex).toBeGreaterThan(sourceControlIndex);
    expect(requiredOutputIndex).toBeGreaterThan(boundaryIndex);
    expect(data.packet).toContain("git rev-parse --show-toplevel");
  });
});
