import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runIssueUpdate } from "../../src/cli/commands/issue-update.command.js";
import { runIssuePromote } from "../../src/cli/commands/issue-promote.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildM11FixtureState, M11_RELEASE_BLOCKER_ISSUE_KEY } from "../m11-fixture.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt issue update", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runIssueUpdate(contextFor(dir), { issueKey: "x", status: "deferred", reason: "y" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 when the issue-key is missing", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssueUpdate(contextFor(dir), { status: "deferred", reason: "y" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("ISSUE-UPDATE-MISSING-KEY");
  });

  it("fails with exit code 3 for an invalid status", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "not-a-real-status",
      reason: "y",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("ISSUE-UPDATE-INVALID-STATUS");
  });

  it("fails with exit code 3 for an empty reason", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "deferred",
      reason: "   ",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("ISSUE-UPDATE-MISSING-REASON");
  });

  it("fails with exit code 3 for an unknown issue key", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssueUpdate(contextFor(dir), {
      issueKey: "checkpoint:WU999:issue:does-not-exist",
      status: "deferred",
      reason: "y",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("ISSUE-UPDATE-UNKNOWN-KEY");
  });

  it("stores the override and appends an issue.updated runlog event", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const runlogBefore = readRunlogLines(dir).length;

    const result = runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "deferred",
      reason: "Defer until release-hardening repair cycle.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);
    expect(state.issues.overrides).toHaveLength(1);
    expect(state.issues.overrides[0]).toMatchObject({
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "deferred",
      reason: "Defer until release-hardening repair cycle.",
      sourceCommand: "aiqt issue update",
    });

    const runlogLines = readRunlogLines(dir);
    expect(runlogLines).toHaveLength(runlogBefore + 1);
    const event = runlogLines[runlogLines.length - 1];
    expect(event.type).toBe("issue.updated");
    expect(event.data.issueKey).toBe(M11_RELEASE_BLOCKER_ISSUE_KEY);
    expect(event.data.status).toBe("deferred");
  });

  it("does not rewrite the original checkpoint", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const before = readState(dir).checkpoints;
    runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "deferred",
      reason: "Accepted.",
    });
    const after = readState(dir).checkpoints;
    expect(after).toEqual(before);
  });

  it("is idempotent when re-applying the same status and reason: no second runlog event", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "deferred",
      reason: "First reason.",
    });
    const runlogAfterFirst = readRunlogLines(dir).length;

    const second = runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "deferred",
      reason: "First reason.",
    });
    expect(second.exitCode).toBe(ExitCode.Success);
    expect((second.data as { changed: boolean }).changed).toBe(false);
    expect(readRunlogLines(dir)).toHaveLength(runlogAfterFirst);
  });

  it("blocks with exit code 2 when the issue has already been promoted", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const promote = runIssuePromote(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      title: "Fix role escalation",
      reason: "Security fix needed.",
      validationCommands: ["pnpm test"],
    });
    expect(promote.exitCode).toBe(ExitCode.Success);

    const result = runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "resolved",
      reason: "Trying to override after promotion.",
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0].id).toBe("ISSUE-UPDATE-ALREADY-PROMOTED");
  });

  it("resolved issue no longer counts as an active release blocker for aiqt manage", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const { runManage } = await import("../../src/cli/commands/manage.command.js");
    const before = runManage(contextFor(dir));
    const beforeBlockers = (before.data as { releaseBlockers: unknown[] }).releaseBlockers;
    expect(beforeBlockers.some((b) => JSON.stringify(b).includes("User profile role escalation"))).toBe(true);

    runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "resolved",
      reason: "Fixed in a follow-up commit.",
    });

    const after = runManage(contextFor(dir));
    const afterBlockers = (after.data as { releaseBlockers: unknown[] }).releaseBlockers;
    expect(afterBlockers.some((b) => JSON.stringify(b).includes("User profile role escalation"))).toBe(false);
  });

  it("post_mvp issue moves to the backlog section", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const { runManage } = await import("../../src/cli/commands/manage.command.js");

    runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "post_mvp",
      reason: "Deferred to a post-MVP hardening pass.",
    });

    const after = runManage(contextFor(dir));
    const data = after.data as { postMvpBacklogCandidates: unknown[]; releaseBlockers: unknown[] };
    expect(data.postMvpBacklogCandidates.some((b) => JSON.stringify(b).includes("User profile role escalation"))).toBe(
      true,
    );
    expect(data.releaseBlockers.some((b) => JSON.stringify(b).includes("User profile role escalation"))).toBe(false);
  });
});
