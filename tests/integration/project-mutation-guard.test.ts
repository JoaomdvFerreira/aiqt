import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { resolveAiqtPaths } from "../../src/core/filesystem/paths.js";
import { buildInitialProjectModel, writeProjectModel } from "../../src/state/project-store.js";
import { acquireProjectMutationGuard } from "../../src/state/project-mutation-guard.js";
import { buildInitialStateModel, writeStateModel } from "../../src/state/workflow-state-store.js";
import { contextFor, makeTempDir, removeDir } from "../helpers.js";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";

vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

describe("M49-WU3 project mutation guard", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) removeDir(dir);
  });

  function initialized(): string {
    const dir = makeTempDir();
    dirs.push(dir);
    expect(runInit(contextFor(dir), normalizeInitOptions({})).exitCode).toBe(0);
    return dir;
  }

  it("serializes one project without globally serializing unrelated projects", () => {
    const first = initialized();
    const second = initialized();
    const firstGuard = acquireProjectMutationGuard({ root: first, command: "update" });
    expect(() => acquireProjectMutationGuard({ root: first, command: "update" })).toThrow(/already in progress/i);
    const secondGuard = acquireProjectMutationGuard({ root: second, command: "update" });
    secondGuard.complete();
    firstGuard.complete();
  });

  it("encloses dispatched CLI mutations and clears their marker on completion", () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const cli = join(process.cwd(), "dist", "index.js");
    const result = spawnSync(process.execPath, [cli, "init", "--json"], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(() => readFileSync(join(dir, ".aiqt-init-interruption.json"), "utf8")).toThrow();
    expect(() => readFileSync(join(dir, ".aiqt-init-mutation.lock"), "utf8")).toThrow();
  });

  it("audits interruptions before and after canonical state changes exactly once", () => {
    const dir = initialized();
    const paths = resolveAiqtPaths(dir);

    acquireProjectMutationGuard({ root: dir, command: "update" }).abandon();
    acquireProjectMutationGuard({ root: dir, command: "update" }).complete();

    const state = buildInitialStateModel("2026-01-01T00:00:00.000Z");
    state.projectStatus = "planned";
    const changed = acquireProjectMutationGuard({ root: dir, command: "update" });
    writeStateModel(paths.stateFile, state);
    changed.abandon();
    acquireProjectMutationGuard({ root: dir, command: "update" }).complete();

    const recovered = readFileSync(paths.runlogFile, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.type === "mutation.interruption_recovered");
    expect(recovered).toHaveLength(2);
    expect(recovered.map((event) => event.data.canonicalStateChanged)).toEqual([false, true]);
  });

  it("retains the marker when recovery audit persistence fails", () => {
    const dir = initialized();
    const paths = resolveAiqtPaths(dir);
    acquireProjectMutationGuard({ root: dir, command: "update" }).abandon();
    rmSync(paths.runlogFile);
    mkdirSync(paths.runlogFile);

    expect(() => acquireProjectMutationGuard({ root: dir, command: "update" })).toThrow(/recovery audit/i);
    expect(() => readFileSync(paths.mutationMarkerFile, "utf8")).not.toThrow();
  });

  it("rejects invalid complete candidates without replacing canonical files", () => {
    const dir = initialized();
    const paths = resolveAiqtPaths(dir);
    const projectBefore = readFileSync(paths.projectFile, "utf8");
    const stateBefore = readFileSync(paths.stateFile, "utf8");

    expect(() => writeProjectModel(paths.projectFile, { version: "0.9.0", project: {} } as never)).toThrow(/Invalid project\.json candidate/);
    expect(() => writeStateModel(paths.stateFile, { version: "0.9.0", workGraph: {} } as never)).toThrow(/Invalid state\.json candidate/);
    expect(readFileSync(paths.projectFile, "utf8")).toBe(projectBefore);
    expect(readFileSync(paths.stateFile, "utf8")).toBe(stateBefore);

    // Keep the initial-model imports covered as valid centralized candidates.
    expect(() => writeProjectModel(paths.projectFile, buildInitialProjectModel({
      id: "PROJECT-001", name: "guard", objective: "", targetUsers: [], preferredAgent: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }))).not.toThrow();
  });
});
