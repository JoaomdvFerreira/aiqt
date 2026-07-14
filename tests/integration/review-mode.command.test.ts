import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { runReviewAcknowledge } from "../../src/cli/commands/review-acknowledge.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildDogfoodTerminalState, DOGFOOD_ACKNOWLEDGE_KEY } from "../dogfood-fixture.js";

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt review --mode", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("defaults to development mode", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const bare = runReviewCommand(contextFor(dir));
    const explicit = runReviewCommand(contextFor(dir), { mode: "development" });
    expect((bare.data as { mode: string }).mode).toBe("development");
    expect(bare.exitCode).toBe(explicit.exitCode);
    expect(bare.status).toBe(explicit.status);
  });

  it("fails with exit code 3 for an unsupported mode", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runReviewCommand(contextFor(dir), { mode: "bogus" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
  });

  it("development review fails (exit 1) before acknowledgment on the dogfood terminal state", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const result = runReviewCommand(contextFor(dir), { mode: "development" });
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    expect(result.status).toBe("failed");
    const data = result.data as { developmentComplete: boolean; productionReady: boolean };
    expect(data.developmentComplete).toBe(false);
    expect(data.productionReady).toBe(false);
  });

  it("release review also fails (exit 1) before acknowledgment", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const result = runReviewCommand(contextFor(dir), { mode: "release" });
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
  });

  it("development review passes (exit 0) after acknowledgment, but release still fails", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);

    const ackResult = runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Live Clerk verification requires user-owned setup and is accepted as a development-complete limitation.",
    });
    expect(ackResult.exitCode).toBe(ExitCode.Success);

    const development = runReviewCommand(contextFor(dir), { mode: "development" });
    expect(development.exitCode).toBe(ExitCode.Success);
    expect(development.status).not.toBe("failed");
    const devData = development.data as { developmentComplete: boolean; productionReady: boolean };
    expect(devData.developmentComplete).toBe(true);
    expect(devData.productionReady).toBe(false);

    const release = runReviewCommand(contextFor(dir), { mode: "release" });
    expect(release.exitCode).toBe(ExitCode.ValidationFailed);
    expect(release.status).toBe("failed");
    const releaseData = release.data as {
      acknowledgedFindings: Array<{ findingKey: string }>;
      activeFindings: Array<{ findingKey: string; acknowledged: boolean }>;
    };
    // Acknowledged findings remain visible in both modes.
    expect(releaseData.acknowledgedFindings.some((a) => a.findingKey === DOGFOOD_ACKNOWLEDGE_KEY)).toBe(true);
    expect(
      releaseData.activeFindings.some((f) => f.findingKey === DOGFOOD_ACKNOWLEDGE_KEY && f.acknowledged),
    ).toBe(true);
  });

  it("advances nextRecommendedCommand past 'aiqt review' once development mode is fully acknowledged", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Accepted limitation.",
    });
    const result = runReviewCommand(contextFor(dir), { mode: "development" });
    expect(result.nextRecommendedCommand).not.toBe("aiqt review");
  });

  it("does not mutate state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readRunlogLines(dir).length;
    runReviewCommand(contextFor(dir), { mode: "development" });
    runReviewCommand(contextFor(dir), { mode: "release" });
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });
});
