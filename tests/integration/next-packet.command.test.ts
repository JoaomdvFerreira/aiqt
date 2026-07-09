import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { RunlogEventSchema } from "../../src/schema/runlog-event.schema.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

/** Bring a fresh project to planningContextReady=true, but not yet planned. */
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

/** Bring a project through init -> update -> plan with one ready work unit. */
async function makePlannedProject(dir: string) {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  const result = runPlan(contextFor(dir), { fromFile: planPath });
  expect(result.exitCode).toBe(ExitCode.Success);
}

describe("aiqt next (packet generation)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("succeeds on a planned project, printing a packet with exit code 0", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(typeof (result.data as Record<string, unknown>).packet).toBe("string");
  });

  it("--json mode: CommandResult contains data.packet and deterministic fields", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const result = runNext(contextFor(dir, true));
    const data = result.data as Record<string, unknown>;
    expect(data.packetId).toBe("PKT-001");
    expect(data.workUnitId).toBe("WU001");
    expect(data.milestoneId).toBe("M001");
    expect(data.packetFormat).toBe("markdown");
    expect(typeof data.contentHash).toBe("string");
    expect((data.contentHash as string).startsWith("sha256:")).toBe(true);
    expect(Array.isArray(data.statusChanges)).toBe(true);
  });

  it("blocks with exit code 2 and recommends aiqt update when the work graph is empty and context is not ready", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt update");
  });

  it("blocks with exit code 2 and recommends aiqt plan when the work graph is empty and context is ready", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt plan");
  });

  it("blocks with exit code 2 and recommends aiqt checkpoint when a work unit is already in progress", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    runNext(contextFor(dir)); // starts WU001
    const second = runNext(contextFor(dir));
    expect(second.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(second.nextRecommendedCommand).toBe("aiqt checkpoint");
  });

  it("blocks with exit code 2 and recommends aiqt review when no ready work unit exists", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const state = readState(dir);
    // Simulate a graph where the only work unit is no longer ready, and no
    // work unit is currently in progress (e.g. a future replan scenario).
    state.workGraph.workUnits[0].status = "planned";
    writeState(dir, state);

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt review");
  });

  it("fails with exit code 3 on invalid canonical state", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    writeFileSync(join(dir, ".aiqt", "state.json"), "{ not valid json");
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 1 and no mutation on a handoff gate failure", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const state = readState(dir);
    state.workGraph.workUnits[0].title = "";
    writeState(dir, state);
    const before = readState(dir);
    const runlogBefore = readRunlogLines(dir).length;

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    expect(result.status).toBe("failed");
    expect(readState(dir)).toEqual(before);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("fails with exit code 3 and no mutation when a dependency reference is broken", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const state = readState(dir);
    state.workGraph.workUnits[0].dependencies = ["DEP-999"];
    writeState(dir, state);
    const before = readState(dir);

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(readState(dir)).toEqual(before);
  });

  it("does not mutate project.json", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const before = readProject(dir);
    runNext(contextFor(dir));
    expect(readProject(dir)).toEqual(before);
  });

  it("mutates state.json and runlog.jsonl only on successful new packet generation", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const stateBefore = readState(dir);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readState(dir)).not.toEqual(stateBefore);
  });

  it("moves the selected work unit from ready to in_progress", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    runNext(contextFor(dir));
    const state = readState(dir);
    expect(state.workGraph.workUnits[0].status).toBe("in_progress");
    expect(state.workGraph.milestones[0].status).toBe("in_progress");
  });

  it("sets currentWorkUnitId/currentMilestoneId and nextRecommendedCommand", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const result = runNext(contextFor(dir));
    expect(result.currentWorkUnitId).toBe("WU001");
    expect(result.currentMilestoneId).toBe("M001");
    expect(result.nextRecommendedCommand).toBe("aiqt checkpoint");
    expect(result.projectStatus).toBe("in_progress");
  });

  it("appends agent_packet.created and work_unit.status_changed on success", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    runNext(contextFor(dir));
    const lines = readRunlogLines(dir) as Array<{ type: string }>;
    const packetEvent = lines.find((e) => e.type === "agent_packet.created");
    const statusEvent = lines.find((e) => e.type === "work_unit.status_changed");
    expect(packetEvent).toBeDefined();
    expect(statusEvent).toBeDefined();
    expect(RunlogEventSchema.safeParse(packetEvent).success).toBe(true);
    expect(RunlogEventSchema.safeParse(statusEvent).success).toBe(true);
    // agent_packet.created must precede work_unit.status_changed.
    expect(lines.indexOf(packetEvent)).toBeLessThan(lines.indexOf(statusEvent));
  });

  it("does not append runlog events on a blocked or failed attempt", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readRunlogLines(dir).length;
    runNext(contextFor(dir));
    expect(readRunlogLines(dir)).toHaveLength(before);
  });

  it("creates no markdown files", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    runNext(contextFor(dir));
    for (const forbidden of ["AIQT.md", "AGENTS.md", "CLAUDE.md", "docs", ".milestones", ".tasks"]) {
      expect(existsSync(join(dir, forbidden))).toBe(false);
    }
  });

  it("fails with exit code 3 and recommends aiqt init when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("packet includes required sections and excludes an unrelated second work unit", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      readFileSync(join(PLAN_FIXTURES, "valid-plan-with-dependencies.json")),
    );
    runPlan(contextFor(dir), { fromFile: planPath });

    const result = runNext(contextFor(dir));
    const packet = (result.data as Record<string, unknown>).packet as string;
    expect(packet).toContain("WU001");
    expect(packet).not.toContain("WU002");
    expect(packet).toContain("## Acceptance Criteria");
    expect(packet).toContain("## Suggested Files / Areas");
  });
});
