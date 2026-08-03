import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { renderHuman } from "../../src/core/output/human-output.js";
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

function readCanonicalFiles(dir: string) {
  return {
    project: readFileSync(join(dir, ".aiqt", "project.json"), "utf8"),
    state: readFileSync(join(dir, ".aiqt", "state.json"), "utf8"),
    runlog: readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8"),
  };
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
    expect(result.summary).toContain("project objective");
    expect(result.summary).toContain("target user");
    expect(result.summary).toContain("implementation-shaping context");
    expect(result.summary).toContain("aiqt update --from-file <path>");
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

  it("previews an initial plan without mutating canonical files or appending runlog events", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const beforeFiles = readCanonicalFiles(dir);
    const beforeState = readState(dir);
    const beforeRunlogCount = readRunlogLines(dir).length;
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));

    const result = runPlan(contextFor(dir), { fromFile: planPath, preview: true });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(result.projectStatus).toBe(beforeState.projectStatus);
    expect(result.currentMilestoneId).toBe(beforeState.currentMilestoneId);
    expect(result.currentWorkUnitId).toBe(beforeState.currentWorkUnitId);
    expect(result.changedFiles).toEqual([]);
    expect(result.summary).toContain("Preview:");
    expect(result.summary).toContain("No files were changed.");
    const data = result.data as { preview: boolean; mutationPerformed: boolean; workGraphWasEmpty: boolean };
    expect(data.preview).toBe(true);
    expect(data.mutationPerformed).toBe(false);
    expect(data.workGraphWasEmpty).toBe(true);

    expect(readCanonicalFiles(dir)).toEqual(beforeFiles);
    const afterState = readState(dir);
    expect(afterState.workGraph.milestones).toHaveLength(0);
    expect(afterState.workGraph.workUnits).toHaveLength(0);
    expect(afterState.workGraph.dependencies).toHaveLength(0);
    expect(afterState.currentMilestoneId).toBe(beforeState.currentMilestoneId);
    expect(afterState.currentWorkUnitId).toBe(beforeState.currentWorkUnitId);
    expect(readRunlogLines(dir)).toHaveLength(beforeRunlogCount);
  });

  it("runs a real initial plan after preview, persisting the graph and appending one runlog event once", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const beforeFiles = readCanonicalFiles(dir);
    const beforeRunlogCount = readRunlogLines(dir).length;
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));

    const preview = runPlan(contextFor(dir), { fromFile: planPath, preview: true });
    expect(preview.exitCode).toBe(ExitCode.Success);
    expect(readCanonicalFiles(dir)).toEqual(beforeFiles);

    const real = runPlan(contextFor(dir), { fromFile: planPath });
    expect(real.exitCode).toBe(ExitCode.Success);
    expect(real.changedFiles).toEqual([
      join(dir, ".aiqt", "state.json"),
      join(dir, ".aiqt", "runlog.jsonl"),
    ]);
    const state = readState(dir);
    expect(state.workGraph.milestones).toHaveLength(1);
    expect(state.workGraph.workUnits).toHaveLength(1);
    const runlog = readRunlogLines(dir) as Array<{ type: string }>;
    expect(runlog).toHaveLength(beforeRunlogCount + 1);
    expect(runlog.filter((event) => event.type === "work_graph.generated")).toHaveLength(1);
  });

  it("renders truthful human output for an initial-plan preview", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(FIXTURES, "valid-plan.json")));

    const output = renderHuman(runPlan(contextFor(dir), { fromFile: planPath, preview: true }));

    expect(output).toContain("Preview: would generate the initial work graph. No files were changed.");
    expect(output).not.toContain("Changed files:");
    expect(output).not.toContain("Work graph generated.");
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
