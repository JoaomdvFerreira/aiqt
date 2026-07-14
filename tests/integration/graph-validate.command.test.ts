import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGraphValidate } from "../../src/cli/commands/graph-validate.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildDependencyFixtureState, M12_DEP_ID } from "../m12-fixture.js";

describe("aiqt graph validate", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runGraphValidate(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("exits 0 with a warning for the DEP-031-style late-stage relates_to pattern", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const result = runGraphValidate(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("warning");
    const data = result.data as { blockingErrors: unknown[]; warnings: Array<{ rule: string; dependencyId?: string }> };
    expect(data.blockingErrors).toEqual([]);
    expect(data.warnings.some((w) => w.rule === "late-stage-relates-to" && w.dependencyId === M12_DEP_ID)).toBe(
      true,
    );
  });

  it("exits 1 when blocking graph integrity errors exist (a dependency cycle)", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.workGraph.dependencies = [
      { id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null },
      { id: "DEP-002", fromId: "WU002", toId: "WU001", type: "blocks", reason: null },
    ];
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runGraphValidate(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    const data = result.data as { blockingErrors: Array<{ rule: string }> };
    expect(data.blockingErrors.some((e) => e.rule === "dependency-cycle")).toBe(true);
  });

  it("is read-only: never mutates state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    await buildDependencyFixtureState(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    runGraphValidate(contextFor(dir));

    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
    expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
  });
});
