import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runIssuePromote } from "../../src/cli/commands/issue-promote.command.js";
import { runIssueUpdate } from "../../src/cli/commands/issue-update.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import {
  buildM11FixtureState,
  M11_AGENT_FIXABLE_ISSUE_KEY,
  M11_RELEASE_BLOCKER_ISSUE_KEY,
} from "../m11-fixture.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt issue promote", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runIssuePromote(contextFor(dir), {
      issueKey: "x",
      title: "t",
      reason: "r",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 when --title is missing", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      reason: "r",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("ISSUE-PROMOTE-MISSING-TITLE");
  });

  it("fails with exit code 3 for an unknown issue key", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssuePromote(contextFor(dir), {
      issueKey: "checkpoint:WU999:issue:does-not-exist",
      title: "t",
      reason: "r",
      validationCommands: ["pnpm test"],
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("ISSUE-PROMOTE-UNKNOWN-KEY");
  });

  it("blocks with exit code 2 when no validation commands can be resolved", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0].id).toBe("ISSUE-PROMOTE-NO-VALIDATION-COMMANDS");
  });

  it("creates a canonical M### repair milestone and WU### work unit, and appends an issue.promoted runlog event", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const runlogBefore = readRunlogLines(dir).length;

    const result = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
      validationCommands: ["pnpm test"],
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitId: string; milestoneId: string; promoted: boolean };
    expect(data.promoted).toBe(true);
    expect(data.milestoneId).toMatch(/^M\d+$/);
    expect(data.milestoneId).not.toContain("REPAIR");
    expect(data.workUnitId).toMatch(/^WU\d+$/);

    const state = readState(dir);
    const milestone = state.workGraph.milestones.find((m: { id: string }) => m.id === data.milestoneId);
    expect(milestone.title).toBe("Review Repair Work");
    const wu = state.workGraph.workUnits.find((w: { id: string }) => w.id === data.workUnitId);
    expect(wu.title).toBe("Repair form error wrappers");
    expect(wu.validationCommands).toEqual(["pnpm test"]);
    expect(wu.status).toBe("ready");
    expect(state.issues.promotions).toHaveLength(1);
    expect(state.issues.promotions[0]).toMatchObject({
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      workUnitId: data.workUnitId,
      milestoneId: data.milestoneId,
      sourceCommand: "aiqt issue promote",
    });

    const runlogLines = readRunlogLines(dir);
    expect(runlogLines).toHaveLength(runlogBefore + 1);
    const event = runlogLines[runlogLines.length - 1];
    expect(event.type).toBe("issue.promoted");
    expect(event.data.workUnitId).toBe(data.workUnitId);
  });

  it("duplicate promotion is idempotent success returning the existing work unit id", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const first = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
      validationCommands: ["pnpm test"],
    });
    const firstData = first.data as { workUnitId: string };
    const runlogAfterFirst = readRunlogLines(dir).length;

    const second = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "A different title, ignored on idempotent replay",
      reason: "Different reason too.",
      validationCommands: ["pnpm test"],
    });
    expect(second.exitCode).toBe(ExitCode.Success);
    const secondData = second.data as { alreadyPromoted: boolean; workUnitId: string };
    expect(secondData.alreadyPromoted).toBe(true);
    expect(secondData.workUnitId).toBe(firstData.workUnitId);
    expect(readRunlogLines(dir)).toHaveLength(runlogAfterFirst);
  });

  it("blocks with exit code 2 for a non-promotable (resolved) issue", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    runIssueUpdate(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      status: "resolved",
      reason: "Already fixed.",
    });

    const result = runIssuePromote(contextFor(dir), {
      issueKey: M11_RELEASE_BLOCKER_ISSUE_KEY,
      title: "Should not be created",
      reason: "Attempting anyway.",
      validationCommands: ["pnpm test"],
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0].id).toBe("ISSUE-PROMOTE-NOT-PROMOTABLE");
  });

  it("sources validationCommands from project.quality.preferredValidationCommands when none are supplied", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const { readProjectModel } = await import("../../src/state/project-store.js");
    const { writeProjectModel } = await import("../../src/state/project-store.js");
    const projectPath = join(dir, ".aiqt", "project.json");
    const project = readProjectModel(projectPath);
    project.quality.preferredValidationCommands = ["pnpm validate"];
    writeProjectModel(projectPath, project);

    const result = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitId: string };
    const state = readState(dir);
    const wu = state.workGraph.workUnits.find((w: { id: string }) => w.id === data.workUnitId);
    expect(wu.validationCommands).toEqual(["pnpm validate"]);
  });

  it("promoted work unit links back into the recomputed milestone status", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const result = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
      validationCommands: ["pnpm test"],
    });
    const data = result.data as { milestoneId: string };
    const state = readState(dir);
    const milestone = state.workGraph.milestones.find((m: { id: string }) => m.id === data.milestoneId);
    expect(milestone.status).toBe("ready");
  });
});
