import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAiqtPaths } from "../../src/core/filesystem/paths.js";
import { buildInitialStateModel, writeStateModel, readStateModel } from "../../src/state/workflow-state-store.js";
import { prepareIsolatedWorkspace, releaseIsolatedWorkspace } from "../../src/workspaces/workspace-service.js";
import { deriveDefaultWorkspaceRoot } from "../../src/workspaces/workspace-path-policy.js";
import { acquireWorkspaceOperationLock } from "../../src/workspaces/workspace-operation-lock.js";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const T1 = "2026-01-01T00:00:00.000Z";

/**
 * M25-WU08 §20/§25.15: concurrency and path-safety hardening against a
 * real disposable Git repository -- not mocks.
 */
describe("workspace hardening (M25-WU08)", () => {
  let repoRootDir: string | null = null;
  let implRoot = "";
  let headSha = "";

  beforeEach(() => {
    repoRootDir = makeTempDir("aiqt-wt-hardening-");
    implRoot = join(repoRootDir, "app");
    mkdirSync(implRoot, { recursive: true });
    headSha = initGitFixtureRepo(implRoot);

    const paths = resolveAiqtPaths(implRoot);
    mkdirSync(paths.aiqtDir, { recursive: true });
    writeStateModel(paths.stateFile, buildInitialStateModel(T1));
    writeFileSync(paths.runlogFile, "");
    execFileSync("git", ["add", ".aiqt"], { cwd: implRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "aiqt state"], { cwd: implRoot });
  });

  afterEach(() => {
    if (repoRootDir) removeDir(repoRootDir);
  });

  it("blocks a concurrent prepare while the workspace-operation lock is held by another operation", () => {
    const paths = resolveAiqtPaths(implRoot);
    const lock = acquireWorkspaceOperationLock(paths.aiqtDir, "external-holder");
    try {
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
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.category).toBe("blocked");
    } finally {
      lock.release();
    }
    // No worktree was created while the lock was held.
    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace?.managedWorkspaces ?? []).toHaveLength(0);
  });

  it("blocks a concurrent release while the workspace-operation lock is held by another operation", () => {
    const paths = resolveAiqtPaths(implRoot);
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);
    const prepared = prepareIsolatedWorkspace({
      paths,
      state: readStateModel(paths.stateFile),
      projectId: "P001",
      workUnitId: "WU001",
      assignmentKey: "wu-1",
      access: "read_write",
      implementationRoot: implRoot,
      workspaceRoot,
      headCommit: headSha,
      timestamp: T1,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    execFileSync("git", ["add", ".aiqt"], { cwd: implRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "state after prepare"], { cwd: implRoot });

    const lock = acquireWorkspaceOperationLock(paths.aiqtDir, "external-holder");
    try {
      const result = releaseIsolatedWorkspace({
        paths,
        state: readStateModel(paths.stateFile),
        workUnitId: "WU001",
        implementationRoot: implRoot,
        timestamp: T1,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.category).toBe("blocked");
    } finally {
      lock.release();
    }
    // The worktree survives untouched while the lock was held.
    expect(existsSync(prepared.workspace!.workspacePath)).toBe(true);
  });

  it("rejects a symlinked workspace root end-to-end through prepareIsolatedWorkspace, with zero side effect", () => {
    const paths = resolveAiqtPaths(implRoot);
    const realRoot = join(repoRootDir!, "real-workspaces");
    const linkedRoot = join(repoRootDir!, "linked-workspaces");
    mkdirSync(realRoot, { recursive: true });
    try {
      symlinkSync(realRoot, linkedRoot, "junction");
    } catch {
      // Some environments (non-admin Windows) cannot create symlinks;
      // skip rather than fail the suite on an environment limitation.
      return;
    }

    const result = prepareIsolatedWorkspace({
      paths,
      state: readStateModel(paths.stateFile),
      projectId: "P001",
      workUnitId: "WU001",
      assignmentKey: "wu-1",
      access: "read_write",
      implementationRoot: implRoot,
      workspaceRoot: linkedRoot,
      headCommit: headSha,
      timestamp: T1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.category).toBe("invalid");
    expect(existsSync(join(linkedRoot, "WS-001"))).toBe(false);

    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace?.managedWorkspaces ?? []).toHaveLength(0);
    expect(finalState.workspace?.pendingWorkspaceOperations ?? []).toHaveLength(0);
  });

  it("release never invokes branch deletion or force removal for a genuinely dirty workspace", () => {
    const paths = resolveAiqtPaths(implRoot);
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);
    const prepared = prepareIsolatedWorkspace({
      paths,
      state: readStateModel(paths.stateFile),
      projectId: "P001",
      workUnitId: "WU001",
      assignmentKey: "wu-1",
      access: "read_write",
      implementationRoot: implRoot,
      workspaceRoot,
      headCommit: headSha,
      timestamp: T1,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    execFileSync("git", ["add", ".aiqt"], { cwd: implRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "state after prepare"], { cwd: implRoot });

    writeFileSync(join(prepared.workspace!.workspacePath, "untracked.txt"), "dirty\n");

    const result = releaseIsolatedWorkspace({
      paths,
      state: readStateModel(paths.stateFile),
      workUnitId: "WU001",
      implementationRoot: implRoot,
      timestamp: T1,
    });
    expect(result.ok).toBe(false);

    // The worktree and its branch both survive -- release performed zero
    // side effect against a dirty target.
    expect(existsSync(prepared.workspace!.workspacePath)).toBe(true);
    const branches = execFileSync("git", ["branch", "--list", prepared.workspace!.branchName!], {
      cwd: implRoot,
      encoding: "utf8",
    });
    expect(branches).toContain(prepared.workspace!.branchName!.split("/").pop());
  });
});
