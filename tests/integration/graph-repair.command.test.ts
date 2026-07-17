import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runGraphRepair } from "../../src/cli/commands/graph-repair.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildDependencyFixtureState, M12_DEP_ID } from "../m12-fixture.js";

describe("aiqt graph repair --dry-run", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when --dry-run is missing", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const result = runGraphRepair(contextFor(dir), { dryRun: false });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("GRAPH-REPAIR-MISSING-DRY-RUN");
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runGraphRepair(contextFor(dir), { dryRun: true });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("generates a deterministic, copy-paste-runnable dependency update suggestion for the DEP-031 pattern", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const result = runGraphRepair(contextFor(dir), { dryRun: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as {
      wouldMutate: boolean;
      suggestions: Array<{ dependencyId: string; recommendedCommand: string }>;
    };
    expect(data.wouldMutate).toBe(false);
    expect(data.suggestions.some((s) => s.dependencyId === M12_DEP_ID)).toBe(true);
    const suggestion = data.suggestions.find((s) => s.dependencyId === M12_DEP_ID)!;
    expect(suggestion.recommendedCommand).toBe(
      `aiqt dependency update ${M12_DEP_ID} --type blocks --reason "Late-stage relates_to dependency likely represents an unmodeled blocking prerequisite."`,
    );
  });

  it("M18: succeeds with exit code 0 when no deterministic repair suggestions are available (dry-run always succeeds)", async () => {
    dir = makeTempDir();
    const { runInit } = await import("../../src/cli/commands/init.command.js");
    const { normalizeInitOptions } = await import("../../src/cli/options.js");
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runGraphRepair(contextFor(dir), { dryRun: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { suggestions: unknown[]; staleReadinessRepairs: unknown[] };
    expect(data.suggestions).toHaveLength(0);
    expect(data.staleReadinessRepairs).toHaveLength(0);
  });

  it("is read-only: never mutates state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    runGraphRepair(contextFor(dir), { dryRun: true });

    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
    expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
  });

  it("is deterministic across repeated calls", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const first = runGraphRepair(contextFor(dir), { dryRun: true });
    const second = runGraphRepair(contextFor(dir), { dryRun: true });
    expect(first.data).toEqual(second.data);
  });
});
