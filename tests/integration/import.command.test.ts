import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runImport } from "../../src/cli/commands/import.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
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

describe("aiqt import", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 on an unsupported import type", async () => {
    dir = makeTempDir();
    const result = await runImport(contextFor(dir), { importType: "bogus", fromFile: "x.json" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
    expect(result.action).toBe("import");
  });

  it("returns needs_input and exit code 10 when --from-file is missing", async () => {
    dir = makeTempDir();
    const result = await runImport(contextFor(dir), { importType: "update" });
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
    expect(result.status).toBe("needs_input");
    expect(result.requiresHumanInput).toBe(true);
  });

  it("import update delegates to aiqt update --from-file behavior", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const patchPath = join(dir, "update.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ project: { objective: "Ship it", targetUsers: ["devs"] } }),
    );
    const result = await runImport(contextFor(dir), { importType: "update", fromFile: patchPath });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(result.action).toBe("import");
    const data = result.data as { import: { importType: string; delegatedAction: string; sourcePath: string } };
    expect(data.import).toEqual({
      importType: "update",
      sourcePath: patchPath,
      delegatedAction: "update",
      followUpCommand: result.nextRecommendedCommand,
    });
    expect(readState(dir).nextRecommendedCommand).toBeDefined();
    const project = JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
    expect(project.project.objective).toBe("Ship it");
  });

  it("import plan delegates to aiqt plan --from-file behavior", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    const result = await runImport(contextFor(dir), { importType: "plan", fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    const state = readState(dir);
    expect(state.workGraph.milestones).toHaveLength(1);
    expect(state.workGraph.workUnits[0].status).toBe("ready");
  });

  it("import checkpoint delegates to aiqt checkpoint --from-file behavior", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });
    runNext(contextFor(dir));

    const result = await runImport(contextFor(dir), {
      importType: "checkpoint",
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    const state = readState(dir);
    expect(state.workGraph.workUnits[0].status).toBe("done");
    const data = result.data as { import: { delegatedAction: string } };
    expect(data.import.delegatedAction).toBe("checkpoint");
  });

  it("fails with exit code 3 when the file is invalid for the delegated type", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });
    runNext(contextFor(dir));

    // Feed a plan-shaped file into "import checkpoint" -- invalid for the
    // delegated type, must fail via the delegated command's own validation.
    const result = await runImport(contextFor(dir), {
      importType: "checkpoint",
      fromFile: planPath,
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
  });

  it("does not append runlog events beyond the delegated command's own behavior on a blocked import", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim().split(/\r?\n/).length;
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    // Context not ready -> aiqt plan blocks with no mutation.
    const result = await runImport(contextFor(dir), { importType: "plan", fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    const runlogAfter = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim().split(/\r?\n/).length;
    expect(runlogAfter).toBe(runlogBefore);
  });
});
