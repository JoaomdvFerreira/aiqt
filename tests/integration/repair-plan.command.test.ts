import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRepairPlan } from "../../src/cli/commands/repair-plan.command.js";
import { runIssuePromote } from "../../src/cli/commands/issue-promote.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import {
  buildM11FixtureState,
  M11_AGENT_FIXABLE_ISSUE_KEY,
  M11_RELEASE_BLOCKER_ISSUE_KEY,
} from "../m11-fixture.js";

describe("aiqt repair plan", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runRepairPlan(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("recommends promotable issues with a fully-substituted, runnable command", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runRepairPlan(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);

    const data = result.data as {
      recommendedRepairs: Array<{ issueKey: string; promotable: boolean; recommendedCommand: string }>;
    };
    const keys = data.recommendedRepairs.map((r) => r.issueKey);
    expect(keys).toContain(M11_AGENT_FIXABLE_ISSUE_KEY);
    expect(keys).toContain(M11_RELEASE_BLOCKER_ISSUE_KEY);
    for (const repair of data.recommendedRepairs) {
      expect(repair.promotable).toBe(true);
      expect(repair.recommendedCommand).toBe(`aiqt issue promote ${repair.issueKey}`);
      expect(repair.recommendedCommand).not.toContain("<issue-key>");
    }
  });

  it("excludes already-promoted issues", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
      validationCommands: ["pnpm test"],
    });

    const result = runRepairPlan(contextFor(dir));
    const data = result.data as { recommendedRepairs: Array<{ issueKey: string }> };
    expect(data.recommendedRepairs.some((r) => r.issueKey === M11_AGENT_FIXABLE_ISSUE_KEY)).toBe(false);
  });

  it("is read-only: does not mutate state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    runRepairPlan(contextFor(dir));

    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
    expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
  });

  it("is deterministic across repeated calls", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const first = runRepairPlan(contextFor(dir));
    const second = runRepairPlan(contextFor(dir));
    expect(first.data).toEqual(second.data);
  });
});
