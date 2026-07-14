import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDependencyUpdate } from "../../src/cli/commands/dependency-update.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import {
  buildDependencyFixtureState,
  buildDependencyInProgressFixtureState,
  M12_DEP_ID,
  M12_READINESS_WORK_UNIT_ID,
} from "../m12-fixture.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt dependency update", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: "DEP-001",
      type: "blocks",
      reason: "y",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 for an unknown dependency", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: "DEP-999",
      type: "blocks",
      reason: "y",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("DEPENDENCY-UPDATE-UNKNOWN-DEPENDENCY");
  });

  it("fails with exit code 3 for an invalid type", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: M12_DEP_ID,
      type: "not-a-real-type",
      reason: "y",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("DEPENDENCY-UPDATE-INVALID-TYPE");
  });

  it("fails with exit code 3 for an empty reason", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: M12_DEP_ID,
      type: "blocks",
      reason: "   ",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("DEPENDENCY-UPDATE-MISSING-REASON");
  });

  it("is an idempotent no-op (exit 0) when the type is unchanged", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const runlogBefore = readRunlogLines(dir).length;
    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: M12_DEP_ID,
      type: "relates_to",
      reason: "No actual change.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect((result.data as { changed: boolean }).changed).toBe(false);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("DEP-031-style: relates_to -> blocks recalculates readiness and prevents premature ready state", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const before = readState(dir);
    expect(
      before.workGraph.workUnits.find((w: { id: string }) => w.id === M12_READINESS_WORK_UNIT_ID).status,
    ).toBe("ready");

    const runlogBefore = readRunlogLines(dir).length;
    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: M12_DEP_ID,
      type: "blocks",
      reason: "i18n readiness must wait for public profile work.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect((result.data as { changed: boolean }).changed).toBe(true);

    const after = readState(dir);
    expect(after.workGraph.dependencies.find((d: { id: string }) => d.id === M12_DEP_ID).type).toBe(
      "blocks",
    );
    expect(
      after.workGraph.workUnits.find((w: { id: string }) => w.id === M12_READINESS_WORK_UNIT_ID).status,
    ).toBe("planned");

    const runlogLines = readRunlogLines(dir);
    expect(runlogLines).toHaveLength(runlogBefore + 1);
    expect(runlogLines[runlogLines.length - 1].type).toBe("dependency.updated");
  });

  it("detects a cycle before mutation and blocks with exit code 2", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    // First tighten profile -> readiness to "blocks" (profile blocks readiness).
    const first = runDependencyUpdate(contextFor(dir), {
      dependencyId: M12_DEP_ID,
      type: "blocks",
      reason: "Tighten the first edge.",
    });
    expect(first.exitCode).toBe(ExitCode.Success);

    // Manually add a second dependency the other direction to set up a cycle
    // opportunity, then attempt to tighten it too.
    const statePath = join(dir, ".aiqt", "state.json");
    const state = readState(dir);
    state.workGraph.dependencies.push({
      id: "DEP-002",
      fromId: "WU001", // readiness
      toId: "WU002", // profile
      type: "relates_to",
      reason: null,
    });
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: "DEP-002",
      type: "blocks",
      reason: "Would introduce a cycle.",
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0].id).toBe("DEPENDENCY-UPDATE-CYCLE");
  });

  it("blocks with exit code 2 when it would invalidate an active in_progress work unit", async () => {
    dir = makeTempDir();
    await buildDependencyInProgressFixtureState(dir);
    const result = runDependencyUpdate(contextFor(dir), {
      dependencyId: M12_DEP_ID,
      type: "blocks",
      reason: "Would invalidate the active execution cycle.",
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0].id).toBe("DEPENDENCY-UPDATE-INVALIDATES-ACTIVE-EXECUTION");

    const state = readState(dir);
    expect(state.workGraph.dependencies.find((d: { id: string }) => d.id === M12_DEP_ID).type).toBe(
      "relates_to",
    );
  });

  it("does not use exit code 10 for any error case", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const missingReason = runDependencyUpdate(contextFor(dir), { dependencyId: M12_DEP_ID, type: "blocks" });
    const unknown = runDependencyUpdate(contextFor(dir), {
      dependencyId: "DEP-999",
      type: "blocks",
      reason: "y",
    });
    expect(missingReason.exitCode).not.toBe(10);
    expect(unknown.exitCode).not.toBe(10);
  });
});
