import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runReviewAcknowledge } from "../../src/cli/commands/review-acknowledge.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildDogfoodTerminalState, DOGFOOD_ACKNOWLEDGE_KEY } from "../dogfood-fixture.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt review acknowledge", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runReviewAcknowledge(contextFor(dir), { findingKey: "x", reason: "y" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 when the finding-key is missing", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runReviewAcknowledge(contextFor(dir), { reason: "y" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("REVIEW-ACKNOWLEDGE-MISSING-KEY");
  });

  it("fails with exit code 3 when --reason is missing or empty", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const missing = runReviewAcknowledge(contextFor(dir), { findingKey: DOGFOOD_ACKNOWLEDGE_KEY });
    expect(missing.exitCode).toBe(ExitCode.InvalidInput);
    expect(missing.blockingIssues[0].id).toBe("REVIEW-ACKNOWLEDGE-MISSING-REASON");

    const whitespace = runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "   ",
    });
    expect(whitespace.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 for an unknown finding key", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const result = runReviewAcknowledge(contextFor(dir), {
      findingKey: "checkpoint:WU999:acceptanceCriteriaResult:partial",
      reason: "not real",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("REVIEW-ACKNOWLEDGE-UNKNOWN-KEY");
  });

  it("writes state.review.acknowledgedFindings and appends a review.finding_acknowledged runlog event", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const runlogBefore = readRunlogLines(dir).length;

    const result = runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Live Clerk verification requires user-owned setup.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");

    const state = readState(dir);
    expect(state.review.acknowledgedFindings).toHaveLength(1);
    expect(state.review.acknowledgedFindings[0]).toMatchObject({
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Live Clerk verification requires user-owned setup.",
      sourceCommand: "aiqt review acknowledge",
    });
    expect(typeof state.review.acknowledgedFindings[0].acknowledgedAt).toBe("string");

    const runlogLines = readRunlogLines(dir) as Array<{ type: string; data: Record<string, unknown> }>;
    expect(runlogLines).toHaveLength(runlogBefore + 1);
    const event = runlogLines[runlogLines.length - 1];
    expect(event.type).toBe("review.finding_acknowledged");
    expect(event.data.findingKey).toBe(DOGFOOD_ACKNOWLEDGE_KEY);
    expect(event.data.sourceCommand).toBe("aiqt review acknowledge");
  });

  it("does not rewrite the original checkpoint", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const before = readState(dir).checkpoints;
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Accepted.",
    });
    const after = readState(dir).checkpoints;
    expect(after).toEqual(before);
  });

  it("is idempotent on duplicate acknowledgment: no second record, no second runlog event", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "First reason.",
    });
    const runlogAfterFirst = readRunlogLines(dir).length;

    const second = runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Second reason attempt.",
    });
    expect(second.exitCode).toBe(ExitCode.Success);
    expect((second.data as { alreadyAcknowledged: boolean }).alreadyAcknowledged).toBe(true);

    const state = readState(dir);
    expect(state.review.acknowledgedFindings).toHaveLength(1);
    expect(state.review.acknowledgedFindings[0].reason).toBe("First reason.");
    expect(readRunlogLines(dir)).toHaveLength(runlogAfterFirst);
  });
});
