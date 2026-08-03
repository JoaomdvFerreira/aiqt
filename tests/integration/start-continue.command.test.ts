import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runStart } from "../../src/cli/commands/start.command.js";
import { runContinue } from "../../src/cli/commands/continue.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
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

async function makeInProgressProject(dir: string, planFixture = "valid-plan.json") {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, planFixture)));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

for (const [label, run] of [
  ["aiqt start", runStart],
  ["aiqt continue", runContinue],
] as const) {
  describe(label, () => {
    let dir: string | null = null;
    afterEach(() => {
      if (dir) removeDir(dir);
      dir = null;
    });

    it("fails with exit code 3 and recommends aiqt init when .aiqt/ is missing", () => {
      dir = makeTempDir();
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.InvalidInput);
      expect(result.status).toBe("failed");
      expect(result.nextRecommendedCommand).toBe("aiqt init");
      const data = result.data as { stage: string } | undefined;
      expect(data?.stage).toBe("not_initialized");
    });

    it("recommends aiqt update on a bare initialized project (context not ready)", () => {
      dir = makeTempDir();
      runInit(contextFor(dir), normalizeInitOptions({}));
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(result.status).toBe("passed");
      expect(result.nextRecommendedCommand).toBe("aiqt update");
      const data = result.data as { stage: string; canProceedWithoutAgent: boolean };
      expect(data.stage).toBe("needs_context");
      expect(data.canProceedWithoutAgent).toBe(true);
    });

    it("recommends aiqt plan when context is ready and the graph is empty", async () => {
      dir = makeTempDir();
      await makeReadyProject(dir);
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(result.nextRecommendedCommand).toBe("aiqt plan");
      const data = result.data as { stage: string };
      expect(data.stage).toBe("needs_plan");
    });

    it("recommends aiqt next when a ready work unit exists", async () => {
      dir = makeTempDir();
      await makeReadyProject(dir);
      const planPath = join(dir, "plan.json");
      writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
      runPlan(contextFor(dir), { fromFile: planPath });
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(result.nextRecommendedCommand).toBe("aiqt next");
      const data = result.data as { stage: string };
      expect(data.stage).toBe("ready_for_handoff");
    });

    it("recommends aiqt checkpoint when a work unit is in progress", async () => {
      dir = makeTempDir();
      await makeInProgressProject(dir);
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(result.nextRecommendedCommand).toBe("aiqt checkpoint");
      const data = result.data as { stage: string };
      expect(data.stage).toBe("awaiting_checkpoint");
    });

    it("uses priority order: in_progress wins over an unrelated needs_review unit", async () => {
      dir = makeTempDir();
      await makeInProgressProject(dir, "valid-plan-with-dependencies.json");
      const state = readState(dir);
      state.workGraph.milestones.push({
        id: "M999",
        title: "Unrelated",
        objective: "Unrelated milestone.",
        status: "in_progress",
        workUnitIds: ["WU999"],
      });
      state.workGraph.workUnits.push({
        id: "WU999",
        milestoneId: "M999",
        title: "Unrelated needing review",
        objective: "O",
        scope: ["s"],
        outOfScope: ["o"],
        acceptanceCriteria: ["a"],
        agentContextRefs: [],
        suggestedFiles: [],
        validationCommands: ["pnpm test"],
        status: "needs_review",
        dependencies: [],
        createdAt: state.lastUpdatedAt,
        updatedAt: state.lastUpdatedAt,
      });
      writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));

      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(result.nextRecommendedCommand).toBe("aiqt checkpoint");
      const data = result.data as { stage: string };
      expect(data.stage).toBe("awaiting_checkpoint");
    });

    it("returns status=warning and recommends aiqt checkpoint amend when a work unit needs review", async () => {
      dir = makeTempDir();
      await makeInProgressProject(dir, "valid-plan-with-dependencies.json");
      const checkpointResult = runCheckpoint(contextFor(dir), {
        fromFile: join(CHECKPOINT_FIXTURES, "valid-needs-review.json"),
      });
      expect(checkpointResult.exitCode).toBe(ExitCode.Success);
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(result.status).toBe("warning");
      expect(result.nextRecommendedCommand).toBe("aiqt checkpoint amend");
      const data = result.data as { stage: string };
      expect(data.stage).toBe("needs_review");
    });

    it("recommends aiqt export all when all work is done", async () => {
      dir = makeTempDir();
      await makeInProgressProject(dir);
      const checkpointResult = runCheckpoint(contextFor(dir), {
        fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
      });
      expect(checkpointResult.exitCode).toBe(ExitCode.Success);
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(result.nextRecommendedCommand).toBe("aiqt export all");
      const data = result.data as { stage: string; followUpCommand: string | null };
      expect(data.stage).toBe("ready_for_export");
      expect(data.followUpCommand).toBeNull();
    });

    it("does not mutate project.json, state.json, or runlog.jsonl", async () => {
      dir = makeTempDir();
      await makeInProgressProject(dir);
      const beforeProject = readProject(dir);
      const beforeState = readState(dir);
      const beforeRunlogLength = readRunlogLines(dir).length;
      run(contextFor(dir));
      expect(readProject(dir)).toEqual(beforeProject);
      expect(readState(dir)).toEqual(beforeState);
      expect(readRunlogLines(dir)).toHaveLength(beforeRunlogLength);
    });

    it("fails with exit code 3 on malformed project.json", () => {
      dir = makeTempDir();
      runInit(contextFor(dir), normalizeInitOptions({}));
      writeFileSync(join(dir, ".aiqt", "project.json"), "{ not valid json");
      const result = run(contextFor(dir));
      expect(result.exitCode).toBe(ExitCode.InvalidInput);
      expect(result.status).toBe("failed");
      const data = result.data as { stage: string } | undefined;
      expect(data?.stage).toBe("invalid_state");
    });
  });
}

describe("RC1: all-done recommendation is consistent across start, continue, and review", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("start, continue, and review all agree on aiqt export all once review has no blocking findings", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const checkpointResult = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(checkpointResult.exitCode).toBe(ExitCode.Success);

    const startResult = runStart(contextFor(dir));
    const continueResult = runContinue(contextFor(dir));
    expect(startResult.nextRecommendedCommand).toBe("aiqt export all");
    expect(continueResult.nextRecommendedCommand).toBe("aiqt export all");

    const reviewResult = runReviewCommand(contextFor(dir));
    expect(reviewResult.exitCode).toBe(ExitCode.Success);
    const reviewData = reviewResult.data as { blockingFindingCount: number };
    expect(reviewData.blockingFindingCount).toBe(0);

    // Once review confirms no blocking findings, review's own next command
    // must equal the same "aiqt export all" that start/continue already
    // pointed to -- the CLI must never disagree with itself here.
    expect(reviewResult.nextRecommendedCommand).toBe("aiqt export all");
    expect(reviewResult.nextRecommendedCommand).toBe(startResult.nextRecommendedCommand);
    expect(reviewResult.nextRecommendedCommand).toBe(continueResult.nextRecommendedCommand);
  });
});
