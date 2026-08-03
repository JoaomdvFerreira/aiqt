import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import {
  makeTempDir,
  removeDir,
  contextFor,
  copyFixture,
} from "../helpers.js";
import { buildDogfoodTerminalState } from "../dogfood-fixture.js";

describe("aiqt status", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("reports draft status after init and does not mutate files", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");

    const result = runStatus(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.projectStatus).toBe("draft");
    expect(result.action).toBe("status");

    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
  });

  it("exposes milestone and work-unit counts in data", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runStatus(contextFor(dir, true));
    const data = result.data as Record<string, unknown>;
    expect(data.milestoneCount).toBe(0);
    expect(data.workUnitCount).toBe(0);
    expect(data.workUnitCounts).toMatchObject({ ready: 0, planned: 0, done: 0 });
  });

  it("fails with exit code 3 on corrupted project.json", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    writeFileSync(join(dir, ".aiqt", "project.json"), "{ broken json");
    const result = runStatus(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
  });

  it("fails with exit code 3 on corrupted state.json", () => {
    dir = copyFixture("corrupted-state");
    const result = runStatus(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues.length).toBeGreaterThan(0);
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runStatus(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("M9: no longer emits the stale NEXT-NOT-IMPLEMENTED warning", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runStatus(contextFor(dir));
    expect(result.warnings.some((w) => w.id === "NEXT-NOT-IMPLEMENTED")).toBe(false);
  });

  it("M32: recommends aiqt manage when all work is done but production is not ready", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const result = runStatus(contextFor(dir));
    expect(result.nextRecommendedCommand).toBe("aiqt manage");
    const data = result.data as { nextActionReason: string };
    expect(data.nextActionReason).toBe(
      "Development is complete but production readiness still has release blockers or gaps.",
    );
    expect(result.warnings.some((w) => w.id === "NEXT-NOT-IMPLEMENTED")).toBe(false);
  });
});
