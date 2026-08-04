import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAiqtPaths } from "../../src/core/filesystem/paths.js";
import { buildInitialStateModel, writeStateModel, readStateModel } from "../../src/state/workflow-state-store.js";
import { prepareIsolatedWorkspace } from "../../src/workspaces/workspace-service.js";
import { deriveDefaultWorkspaceRoot } from "../../src/workspaces/workspace-path-policy.js";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const T1 = "2026-01-01T00:00:00.000Z";

/**
 * M25 §25.7/§25.18: exercises the real (impure) prepare orchestration
 * against a genuine disposable Git repository and a genuine .aiqt
 * state.json/runlog.jsonl -- not mocks.
 */
describe("prepareIsolatedWorkspace (M25-WU04, real disposable repository)", () => {
  let repoRootDir: string | null = null;
  let implRoot = "";
  let headSha = "";

  beforeAll(() => {
    repoRootDir = makeTempDir("aiqt-wt-prepare-");
    implRoot = join(repoRootDir, "app");
    mkdirSync(implRoot, { recursive: true });
    // initGitFixtureRepo (tests/helpers.ts) disables core.autocrlf on this
    // disposable fixture repo -- otherwise a Windows global
    // `core.autocrlf=true` can make a freshly committed text file appear
    // "dirty" to `git diff --quiet` purely from CRLF/LF conversion, with
    // zero real edits.
    headSha = initGitFixtureRepo(implRoot);

    const paths = resolveAiqtPaths(implRoot);
    mkdirSync(paths.aiqtDir, { recursive: true });
    writeStateModel(paths.stateFile, buildInitialStateModel(T1));
    writeFileSync(paths.runlogFile, "");
    // .aiqt/state.json and .aiqt/runlog.jsonl are tracked project state (only
    // .aiqt/exports is gitignored by convention), so commit them here too --
    // otherwise this fixture would leave the working tree untracked-dirty
    // before prepare's clean-repository precondition even runs.
    execFileSync("git", ["add", ".aiqt"], { cwd: implRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "aiqt state"], { cwd: implRoot });
  });

  afterAll(() => {
    if (repoRootDir) removeDir(repoRootDir);
  });

  it("creates a real worktree, branch, and canonical records on a clean repository", () => {
    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);

    const result = prepareIsolatedWorkspace({
      paths,
      state,
      projectId: "P001",
      workUnitId: "WU001",
      assignmentKey: "wu-1",
      access: "read_write",
      implementationRoot: implRoot,
      workspaceRoot,
      headCommit: headSha,
      timestamp: T1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("created");
    expect(result.workspace?.generation).toBe(1);
    expect(existsSync(result.workspace!.workspacePath)).toBe(true);

    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace?.managedWorkspaces).toHaveLength(1);
    expect(finalState.workspace?.pendingWorkspaceOperations).toEqual([]);
    expect(finalState.workspace?.workspaceBindings).toHaveLength(1);

    const branchLeaf = result.workspace!.branchName!.split("/").pop()!;
    const branches = execFileSync("git", ["branch", "--list", result.workspace!.branchName!], {
      cwd: implRoot,
      encoding: "utf8",
    });
    expect(branches).toContain(branchLeaf);

    // Prepare's own state writes (.aiqt/state.json, .aiqt/runlog.jsonl) are
    // tracked project files, so they leave the working tree dirty until
    // committed -- mirror the expected commit discipline here so later
    // tests see the clean baseline §10.1 requires for a *new* prepare.
    execFileSync("git", ["add", ".aiqt"], { cwd: implRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "aiqt state after first prepare"], { cwd: implRoot });
  });

  it("is idempotent (no_op, byte-identical state) for a repeated prepare of the same work unit", () => {
    const paths = resolveAiqtPaths(implRoot);
    const before = readStateModel(paths.stateFile);
    const state = before;
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);

    const result = prepareIsolatedWorkspace({
      paths,
      state,
      projectId: "P001",
      workUnitId: "WU001",
      assignmentKey: "wu-1",
      access: "read_write",
      implementationRoot: implRoot,
      workspaceRoot,
      headCommit: headSha,
      timestamp: T1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("no_op");
    expect(readStateModel(paths.stateFile)).toEqual(before);
  });

  it("blocks a new prepare with exit-2-shaped blocked category when the repository is dirty", () => {
    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);
    writeFileSync(join(implRoot, "README.md"), "dirty\n");
    try {
      const result = prepareIsolatedWorkspace({
        paths,
        state,
        projectId: "P001",
        workUnitId: "WU002",
        assignmentKey: "wu-2",
        access: "read_write",
        implementationRoot: implRoot,
        workspaceRoot,
        headCommit: headSha,
        timestamp: T1,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.category).toBe("blocked");
    } finally {
      execFileSync("git", ["checkout", "--quiet", "--", "README.md"], { cwd: implRoot });
    }
  });

  it("prepares a second, independent isolated workspace for a distinct assignment key", () => {
    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);

    const result = prepareIsolatedWorkspace({
      paths,
      state,
      projectId: "P001",
      workUnitId: "WU002",
      assignmentKey: "wu-2",
      access: "read_write",
      implementationRoot: implRoot,
      workspaceRoot,
      headCommit: headSha,
      timestamp: T1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("created");

    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace?.managedWorkspaces).toHaveLength(2);
    const ids = finalState.workspace!.managedWorkspaces.map((w) => w.id);
    expect(new Set(ids).size).toBe(2);
  });
});
