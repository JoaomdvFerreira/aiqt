import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
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

async function makeInProgressProject(dir: string, planFixture = "valid-plan.json") {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, planFixture)));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt review", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 and recommends aiqt init when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("warns and recommends aiqt update on a bare initialized project (empty graph, context not ready)", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runReviewCommand(contextFor(dir));
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt update");
    const data = result.data as Record<string, unknown>;
    expect(data.blockingFindingCount).toBe(0);
  });

  it("warns and recommends aiqt plan when context is ready but no work graph exists", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runReviewCommand(contextFor(dir));
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt plan");
  });

  it("warns and recommends aiqt checkpoint when a work unit is in_progress", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runReviewCommand(contextFor(dir));
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt checkpoint");
  });

  it("recommends aiqt checkpoint amend when a needs_review work unit exists alongside a ready one", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir, "valid-plan-with-dependencies.json");
    const result1 = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-needs-review.json"),
    });
    expect(result1.exitCode).toBe(ExitCode.Success);
    const result = runReviewCommand(contextFor(dir));
    expect(result.status).toBe("warning");
    expect(result.nextRecommendedCommand).toBe("aiqt checkpoint amend");
    const data = result.data as Record<string, unknown>;
    expect(data.blockingFindingCount).toBe(0);
  });

  it("does not mutate project.json, state.json, or runlog.jsonl", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const beforeProject = readProject(dir);
    const beforeState = readState(dir);
    const beforeRunlogLength = readRunlogLines(dir).length;
    runReviewCommand(contextFor(dir));
    expect(readProject(dir)).toEqual(beforeProject);
    expect(readState(dir)).toEqual(beforeState);
    expect(readRunlogLines(dir)).toHaveLength(beforeRunlogLength);
  });

  it("fails with exit code 1 and a critical/blocking integrity finding on a broken dependency reference", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const state = readState(dir);
    state.workGraph.dependencies.push({
      id: "DEP-999",
      type: "blocks",
      fromId: "WU001",
      toId: "WU999",
      reason: null,
    });
    writeState(dir, state);
    const beforeState = readState(dir);

    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    expect(result.status).toBe("failed");
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.blockingIssues[0].severity).toBe("critical");
    expect(result.blockingIssues[0].area).toBe("integrity");
    expect(readState(dir)).toEqual(beforeState);
  });

  it("fails with exit code 3 on malformed project.json", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    writeFileSync(join(dir, ".aiqt", "project.json"), "{ not valid json");
    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBeNull();
  });

  it("warns (not blocks) on malformed runlog lines and exposes runlogHealth in data", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const existing = readFileSync(runlogPath, "utf8");
    writeFileSync(runlogPath, existing + "{ not valid jsonl\n");
    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.warnings.length).toBeGreaterThan(0);
    const data = result.data as { runlogHealth?: { malformedLines: number } };
    expect(data.runlogHealth?.malformedLines).toBe(1);
  });

  it("assigns FIND-### ids in stable sorted order (blocking-first, then severity)", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runReviewCommand(contextFor(dir));
    const data = result.data as { findings: Array<{ id: string; blocking: boolean }> };
    expect(data.findings[0].id).toBe("FIND-001");
    const ids = data.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < data.findings.length; i++) {
      expect(data.findings[i - 1].blocking || !data.findings[i].blocking).toBe(true);
    }
  });

  it("passes with no findings recommendation of aiqt export all when all work is done (RC1 canonical all-done recommendation)", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const checkpointResult = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(checkpointResult.exitCode).toBe(ExitCode.Success);
    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt export all");
    const data = result.data as { recommendedExportTargets: string[] };
    expect(data.recommendedExportTargets).toContain("status-report");
    expect(data.recommendedExportTargets).not.toContain("project-summary");
  });
});

describe("aiqt review: checkpoint packet ID integrity", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("does not flag a checkpoint whose packetId matches state.lastAgentPacket.id", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const checkpointResult = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(checkpointResult.exitCode).toBe(ExitCode.Success);
    const state = readState(dir);
    expect(state.checkpoints[0].packetId).toBe("PKT-001");

    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { blockingFindingCount: number };
    expect(data.blockingFindingCount).toBe(0);
  });

  it("does not flag a historical checkpoint whose packetId is superseded by a newer lastAgentPacket but recorded in runlog agent_packet.created history", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir, "valid-plan-with-dependencies.json");

    // WU001 checkpoint captured with packetId PKT-001 (current at that time).
    const doneResult = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(doneResult.exitCode).toBe(ExitCode.Success);

    // WU002 becomes ready and is selected next, generating PKT-002 and
    // superseding state.lastAgentPacket -- WU001's checkpoint now references
    // a "historical" packet ID that only exists in runlog history.
    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);
    expect(state.checkpoints[0].packetId).toBe("PKT-001");
    expect(state.lastAgentPacket.id).toBe("PKT-002");
    expect(state.lastAgentPacket.id).not.toBe(state.checkpoints[0].packetId);

    const result = runReviewCommand(contextFor(dir));
    const data = result.data as {
      blockingFindingCount: number;
      findings: Array<{ category: string; message: string }>;
    };
    const packetFindings = data.findings.filter((f) =>
      f.message.includes("does not exist in state.lastAgentPacket or runlog packet history"),
    );
    expect(packetFindings).toHaveLength(0);
  });

  it("fails with exit code 1 and a blocking integrity finding when a checkpoint references an unknown packet ID", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const checkpointResult = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(checkpointResult.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);
    state.checkpoints[0].packetId = "PKT-999";
    writeState(dir, state);

    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    expect(result.status).toBe("failed");
    const data = result.data as {
      findings: Array<{
        category: string;
        severity: string;
        blocking: boolean;
        relatedIds: string[];
        nextRecommendedCommand: string | null;
      }>;
    };
    const finding = data.findings.find((f) => f.relatedIds.includes("PKT-999"));
    expect(finding).toBeDefined();
    expect(finding?.category).toBe("integrity");
    expect(finding?.severity).toBe("high");
    expect(finding?.blocking).toBe(true);
    expect(finding?.relatedIds).toEqual(expect.arrayContaining(["C001", "PKT-999"]));
    expect(finding?.nextRecommendedCommand).toBe("aiqt review");
    expect(result.blockingIssues.some((i) => i.affectedItems?.includes("PKT-999"))).toBe(true);
  });

  it("does not crash and still reports malformed-runlog warnings when packet history includes bad lines", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const existing = readFileSync(runlogPath, "utf8");
    writeFileSync(runlogPath, existing + "{ not valid jsonl\n");

    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
