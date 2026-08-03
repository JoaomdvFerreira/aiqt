import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { RunlogEventSchema } from "../../src/schema/runlog-event.schema.js";
import * as runlogStore from "../../src/state/runlog-store.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");

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

/** init -> update -> plan -> next, leaving WU001 in_progress. */
async function makeInProgressProject(dir: string, planFixture = "valid-plan.json") {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, planFixture)));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt checkpoint", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("returns requiresHumanInput and exit code 10 when no --from-file is supplied", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
    expect(result.status).toBe("needs_input");
    expect(result.requiresHumanInput).toBe(true);
    expect(result.nextRecommendedCommand).toBe("aiqt checkpoint --from-file <path>");
  });

  it("fails with exit code 3 and recommends aiqt init when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("blocks with exit code 2 and recommends aiqt update when the work graph is empty and context is not ready", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt update");
  });

  it("blocks with exit code 2 and recommends aiqt plan when the work graph is empty and context is ready", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt plan");
  });

  it("blocks with exit code 2 and recommends aiqt next when no work unit is in progress", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt next");
  });

  it("fails with exit code 3 when currentWorkUnitId references an unknown work unit", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const state = readState(dir);
    state.currentWorkUnitId = "WU999";
    writeState(dir, state);
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt next");
  });

  it("fails with exit code 3 when the current work unit is not in_progress", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const state = readState(dir);
    state.workGraph.workUnits[0].status = "ready";
    writeState(dir, state);
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt next");
  });

  it("fails with exit code 3 when lastAgentPacket is missing or mismatched", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const state = readState(dir);
    state.lastAgentPacket = null;
    writeState(dir, state);
    const result = runCheckpoint(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt next");
  });

  it("fails with exit code 3 on invalid checkpoint JSON", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const badPath = join(dir, "bad.json");
    writeFileSync(badPath, "{ not valid json");
    const result = runCheckpoint(contextFor(dir), { fromFile: badPath });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe(`aiqt checkpoint --from-file ${badPath}`);
  });

  it("fails with exit code 3 on schema validation failure (unknown nested key)", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "invalid-schema.json"),
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 1 and no mutation when targetStatus=done fails the completion gate", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const before = readState(dir);
    const path = join(CHECKPOINT_FIXTURES, "invalid-completion-claim.json");
    const result = runCheckpoint(contextFor(dir), { fromFile: path });
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    expect(result.status).toBe("failed");
    expect(result.nextRecommendedCommand).toBe(`aiqt checkpoint --from-file ${path}`);
    expect(result.blockingIssues[0].area).toBe("checkpoint");
    expect(result.blockingIssues[0].suggestedAction).toBe(
      "Correct the checkpoint input and rerun aiqt checkpoint.",
    );
    expect(readState(dir)).toEqual(before);
  });

  it("succeeds: valid done checkpoint marks the work unit done and clears currentWorkUnitId", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(result.currentWorkUnitId).toBeNull();
    const state = readState(dir);
    expect(state.currentWorkUnitId).toBeNull();
    expect(state.workGraph.workUnits[0].status).toBe("done");
    expect(state.checkpoints).toHaveLength(1);
    expect(state.checkpoints[0].id).toBe("C001");
  });

  it("succeeds: valid needs_review checkpoint recommends aiqt review", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-needs-review.json"),
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt review");
    const state = readState(dir);
    expect(state.workGraph.workUnits[0].status).toBe("needs_review");
    expect(state.currentMilestoneId).toBe("M001");
  });

  it("needs_review takes priority over an unrelated ready work unit", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir, "valid-plan-with-dependencies.json");
    // valid-plan-with-dependencies has WU001 blocking WU002; WU001 is
    // in_progress here and WU002 is still planned (not ready), so we craft
    // an unrelated always-ready sibling by editing state directly.
    const state = readState(dir);
    state.workGraph.milestones.push({
      id: "M999",
      title: "Unrelated",
      objective: "Unrelated milestone.",
      status: "ready",
      workUnitIds: ["WU999"],
    });
    state.workGraph.workUnits.push({
      id: "WU999",
      milestoneId: "M999",
      title: "Unrelated ready work",
      objective: "O",
      scope: ["s"],
      outOfScope: ["o"],
      acceptanceCriteria: ["a"],
      agentContextRefs: [],
      suggestedFiles: [],
      validationCommands: ["pnpm test"],
      status: "ready",
      dependencies: [],
      createdAt: state.lastUpdatedAt,
      updatedAt: state.lastUpdatedAt,
    });
    writeState(dir, state);

    const result = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-needs-review.json"),
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt review");
  });

  it("done checkpoint unlocks downstream planned work and recommends aiqt next", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir, "valid-plan-with-dependencies.json");
    const result = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as Record<string, unknown>;
    expect(data.newlyReadyWorkUnitIds).toEqual(["WU002"]);
    expect(result.nextRecommendedCommand).toBe("aiqt next");
    const state = readState(dir);
    expect(state.workGraph.workUnits[1].status).toBe("ready");
  });

  it("moves the project to review when all work is done", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir); // single-work-unit plan
    const result = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.projectStatus).toBe("review");
    expect(result.nextRecommendedCommand).toBe("aiqt review");
  });

  it("does not mutate project.json", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const before = readProject(dir);
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(readProject(dir)).toEqual(before);
  });

  it("preserves lastAgentPacket after checkpoint", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const before = readState(dir).lastAgentPacket;
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(readState(dir).lastAgentPacket).toEqual(before);
  });

  it("appends checkpoint.created before work_unit.status_changed", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const lines = readRunlogLines(dir) as Array<{
      type: string;
      data?: { toStatus?: string };
    }>;
    const checkpointEvent = lines.find((e) => e.type === "checkpoint.created");
    // The runlog already contains an earlier work_unit.status_changed event
    // from aiqt next (ready -> in_progress); find the one the checkpoint
    // itself appended (in_progress -> done).
    const statusEvent = lines.find(
      (e) => e.type === "work_unit.status_changed" && e.data?.toStatus === "done",
    );
    expect(checkpointEvent).toBeDefined();
    expect(statusEvent).toBeDefined();
    expect(RunlogEventSchema.safeParse(checkpointEvent).success).toBe(true);
    expect(RunlogEventSchema.safeParse(statusEvent).success).toBe(true);
    expect(lines.indexOf(checkpointEvent)).toBeLessThan(lines.indexOf(statusEvent));
  });

  it("does not mutate state or append runlog events on failed/blocked attempts", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const stateBefore = readState(dir);
    const runlogBefore = readRunlogLines(dir).length;
    runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "invalid-completion-claim.json"),
    });
    expect(readState(dir)).toEqual(stateBefore);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("surfaces a runlog-gap diagnostic after checkpoint state is written and retry does not duplicate checkpoint state", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const checkpointPath = join(CHECKPOINT_FIXTURES, "valid-done.json");
    const runlogBefore = readRunlogLines(dir).length;
    const spy = vi.spyOn(runlogStore, "appendRunlogEvent").mockImplementationOnce(() => {
      throw new Error("simulated append failure");
    });

    const failed = runCheckpoint(contextFor(dir), { fromFile: checkpointPath });
    spy.mockRestore();

    expect(failed.exitCode).toBe(ExitCode.InvalidInput);
    expect(failed.status).toBe("failed");
    expect(failed.summary).toContain("runlog append failed");
    const stateAfterFailure = readState(dir);
    expect(stateAfterFailure.checkpoints).toHaveLength(1);
    expect(stateAfterFailure.currentWorkUnitId).toBeNull();
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);

    const retry = runCheckpoint(contextFor(dir), { fromFile: checkpointPath });

    expect(retry.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(readState(dir).checkpoints).toHaveLength(1);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("creates no markdown files", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    for (const forbidden of ["AIQT.md", "AGENTS.md", "CLAUDE.md", "docs", ".milestones", ".tasks"]) {
      expect(existsSync(join(dir, forbidden))).toBe(false);
    }
  });

  it("returns deterministic CommandResult JSON with checkpoint data fields", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    const data = result.data as Record<string, unknown>;
    expect(data).toMatchObject({
      checkpointId: "C001",
      workUnitId: "WU001",
      packetId: "PKT-001",
      fromStatus: "in_progress",
      toStatus: "done",
      validationResult: "passed",
      acceptanceCriteriaResult: "passed",
    });
  });
});
