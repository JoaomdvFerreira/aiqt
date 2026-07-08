import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { RunlogEventSchema } from "../../src/schema/runlog-event.schema.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "fixtures", "plans");

function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

/** Bring a fresh project to a planningContextReady=true state. */
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

describe("aiqt plan", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("returns requiresHumanInput and exit code 10 when no --from-file is supplied", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runPlan(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
    expect(result.status).toBe("needs_input");
    expect(result.requiresHumanInput).toBe(true);
    expect(result.nextRecommendedCommand).toBe("aiqt plan --from-file <path>");
  });

  it("evaluates the no-input gate before planningContextReady", async () => {
    // Context is not ready (fresh init), but omitting --from-file must still
    // return exit code 10, not exit code 2.
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runPlan(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
  });

  it("blocks with exit code 2 when planningContextReady is false", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));
    const result = runPlan(contextFor(dir), { fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedCommand).toBe("aiqt update");
    expect(readState(dir).workGraph.milestones).toHaveLength(0);
  });

  it("ingests a valid plan, populating state.workGraph", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));

    const result = runPlan(contextFor(dir), { fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(result.projectStatus).toBe("planned");
    expect(result.currentMilestoneId).toBe("M001");
    expect(result.currentWorkUnitId).toBeNull();
    expect(result.nextRecommendedCommand).toBe("aiqt next");

    const state = readState(dir);
    expect(state.projectStatus).toBe("planned");
    expect(state.workGraph.milestones).toHaveLength(1);
    expect(state.workGraph.workUnits).toHaveLength(1);
    expect(state.workGraph.workUnits[0].status).toBe("ready");
    expect(state.currentWorkUnitId).toBeNull();
  });

  it("returns a deterministic CommandResult JSON shape", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));

    const result = runPlan(contextFor(dir), { fromFile: planPath });
    const data = result.data as Record<string, unknown>;
    expect(data).toMatchObject({
      milestoneCount: 1,
      workUnitCount: 1,
      dependencyCount: 0,
      readyWorkUnitId: "WU001",
      readyWorkUnitCount: 1,
      plannedWorkUnitCount: 0,
      workGraphWasEmpty: true,
    });
  });

  it("does not mutate project.json", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const before = readProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });
    expect(readProject(dir)).toEqual(before);
  });

  it("appends a valid work_graph.generated event only on success", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });

    const lines = readRunlogLines(dir);
    const event = lines.find(
      (e) => (e as { type: string }).type === "work_graph.generated",
    );
    expect(event).toBeDefined();
    expect(RunlogEventSchema.safeParse(event).success).toBe(true);
  });

  it("blocks with exit code 2 and no mutation on an existing non-empty work graph", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });

    const before = readState(dir);
    const runlogBefore = readRunlogLines(dir).length;
    const second = runPlan(contextFor(dir), { fromFile: planPath });
    expect(second.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(second.status).toBe("blocked");
    expect(readState(dir)).toEqual(before);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("rejects invalid plan input with exit code 3 and leaves state/runlog unchanged", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const stateBefore = readState(dir);
    const runlogBefore = readRunlogLines(dir).length;

    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "invalid-plan.json")));
    const result = runPlan(contextFor(dir), { fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
    expect(readState(dir)).toEqual(stateBefore);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("rejects a circular blocking dependency with exit code 3", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "circular-dependencies.json")));
    const result = runPlan(contextFor(dir), { fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(readState(dir).workGraph.milestones).toHaveLength(0);
  });

  it("rejects a duplicate dependency with exit code 3", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "duplicate-dependencies.json")));
    const result = runPlan(contextFor(dir), { fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 when --from-file path does not exist", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runPlan(contextFor(dir), { fromFile: join(dir, "nope.json") });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("ingests a valid plan with dependencies, producing ready/planned statuses", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      readFileSync(join(FIXTURES, "valid-plan-with-dependencies.json")),
    );
    const result = runPlan(contextFor(dir), { fromFile: planPath });
    expect(result.exitCode).toBe(ExitCode.Success);
    const state = readState(dir);
    expect(state.workGraph.milestones).toHaveLength(2);
    expect(state.workGraph.workUnits).toHaveLength(2);
    expect(state.workGraph.dependencies).toHaveLength(1);
    expect(state.workGraph.workUnits[0].status).toBe("ready");
    expect(state.workGraph.workUnits[1].status).toBe("planned");
  });

  it("creates no markdown files", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });
    for (const forbidden of ["AIQT.md", "AGENTS.md", "CLAUDE.md", "docs"]) {
      expect(existsSync(join(dir, forbidden))).toBe(false);
    }
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runPlan(contextFor(dir), { fromFile: join(dir, "plan.json") });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });
});
