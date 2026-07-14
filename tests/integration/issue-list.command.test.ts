import { describe, it, expect, afterEach } from "vitest";
import { runIssueList } from "../../src/cli/commands/issue-list.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import {
  buildM11FixtureState,
  M11_AGENT_FIXABLE_ISSUE_KEY,
  M11_RELEASE_BLOCKER_ISSUE_KEY,
} from "../m11-fixture.js";

describe("aiqt issue list", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runIssueList(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("lists normalized checkpoint issues deterministically with counts", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssueList(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);

    const data = result.data as {
      issues: Array<{ issueKey: string; status: string }>;
      counts: Record<string, number>;
    };
    const keys = data.issues.map((i) => i.issueKey);
    expect(keys).toContain(M11_AGENT_FIXABLE_ISSUE_KEY);
    expect(keys).toContain(M11_RELEASE_BLOCKER_ISSUE_KEY);
    expect(data.counts.active).toBe(2);
    expect(data.counts.promoted).toBe(0);
  });

  it("is read-only: does not mutate state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    runIssueList(contextFor(dir));

    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
    expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
  });
});
