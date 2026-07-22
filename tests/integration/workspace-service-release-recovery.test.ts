import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAiqtPaths } from "../../src/core/filesystem/paths.js";
import { buildInitialStateModel, writeStateModel, readStateModel } from "../../src/state/workflow-state-store.js";
import { prepareIsolatedWorkspace, releaseIsolatedWorkspace } from "../../src/workspaces/workspace-service.js";
import { deriveDefaultWorkspaceRoot } from "../../src/workspaces/workspace-path-policy.js";
import { recoverWorkspaceOperations } from "../../src/workspaces/workspace-recovery.js";
import { makeTempDir, removeDir } from "../helpers.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

/**
 * M25 §12.2/§14.2/§15/§25.7: exercises the real (impure) release and
 * recovery orchestration against a genuine disposable Git repository.
 */
describe("releaseIsolatedWorkspace / recoverWorkspaceOperations (M25-WU05, real disposable repository)", () => {
  let repoRootDir: string | null = null;
  let implRoot = "";
  let headSha = "";

  beforeEach(() => {
    repoRootDir = makeTempDir("aiqt-wt-release-");
    implRoot = join(repoRootDir, "app");
    mkdirSync(implRoot, { recursive: true });
    execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: implRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: implRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: implRoot });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: implRoot });
    writeFileSync(join(implRoot, "README.md"), "hello\n");
    execFileSync("git", ["add", "README.md"], { cwd: implRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: implRoot });
    headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: implRoot, encoding: "utf8" }).trim();

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

  function prepare(workUnitId: string, assignmentKey: string) {
    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);
    return prepareIsolatedWorkspace({
      paths,
      state,
      projectId: "P001",
      workUnitId,
      assignmentKey,
      access: "read_write",
      implementationRoot: implRoot,
      workspaceRoot,
      headCommit: headSha,
      timestamp: T1,
    });
  }

  function commitAiqtState(message: string) {
    execFileSync("git", ["add", ".aiqt"], { cwd: implRoot });
    execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: implRoot });
  }

  it("releases a real worktree: removes the directory, unregisters it, and preserves the branch", () => {
    const prepared = prepare("WU001", "wu-1");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    commitAiqtState("aiqt state after prepare");

    const workspacePath = prepared.workspace!.workspacePath;
    const branchName = prepared.workspace!.branchName!;
    expect(existsSync(workspacePath)).toBe(true);

    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const result = releaseIsolatedWorkspace({
      paths,
      state,
      workUnitId: "WU001",
      implementationRoot: implRoot,
      timestamp: T2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("released");
    expect(existsSync(workspacePath)).toBe(false);

    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace?.pendingWorkspaceOperations).toEqual([]);
    const workspace = finalState.workspace!.managedWorkspaces.find((w) => w.id === prepared.workspace!.id)!;
    expect(workspace.lifecycleStatus).toBe("released");
    const binding = finalState.workspace!.workspaceBindings.find((b) => b.workUnitId === "WU001")!;
    expect(binding.status).toBe("released");

    // The branch itself must survive release -- never deleted.
    const branches = execFileSync("git", ["branch", "--list", branchName], { cwd: implRoot, encoding: "utf8" });
    expect(branches).toContain(branchName.split("/").pop());
  });

  it("is a no-op for a work unit with no active binding", () => {
    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const result = releaseIsolatedWorkspace({
      paths,
      state,
      workUnitId: "WU999",
      implementationRoot: implRoot,
      timestamp: T2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("no_op");
  });

  it("blocks release (blocked, exit 2) when the worktree is dirty, with zero side effect", () => {
    const prepared = prepare("WU001", "wu-1");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    commitAiqtState("aiqt state after prepare");

    const workspacePath = prepared.workspace!.workspacePath;
    writeFileSync(join(workspacePath, "scratch.txt"), "uncommitted\n");

    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const result = releaseIsolatedWorkspace({
      paths,
      state,
      workUnitId: "WU001",
      implementationRoot: implRoot,
      timestamp: T2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.category).toBe("blocked");
    expect(existsSync(workspacePath)).toBe(true);

    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace?.pendingWorkspaceOperations).toEqual([]);
    const workspace = finalState.workspace!.managedWorkspaces.find((w) => w.id === prepared.workspace!.id)!;
    expect(workspace.lifecycleStatus).toBe("ready");
  });

  it("repeated release after successful finalization is a no-op", () => {
    const prepared = prepare("WU001", "wu-1");
    if (!prepared.ok) return;
    commitAiqtState("aiqt state after prepare");

    const paths = resolveAiqtPaths(implRoot);
    const first = releaseIsolatedWorkspace({
      paths,
      state: readStateModel(paths.stateFile),
      workUnitId: "WU001",
      implementationRoot: implRoot,
      timestamp: T2,
    });
    expect(first.ok).toBe(true);

    const second = releaseIsolatedWorkspace({
      paths,
      state: readStateModel(paths.stateFile),
      workUnitId: "WU001",
      implementationRoot: implRoot,
      timestamp: T2,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome).toBe("no_op");
  });

  it("recovers an interrupted release (pending survives, worktree still clean and present) via --apply, actually retrying the removal", () => {
    const prepared = prepare("WU001", "wu-1");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    commitAiqtState("aiqt state after prepare");

    const workspacePath = prepared.workspace!.workspacePath;
    const branchName = prepared.workspace!.branchName!;
    expect(existsSync(workspacePath)).toBe(true);

    // Simulate an interruption between §14.2 step 2 (pending release
    // persisted) and step 3 (the `git worktree remove` side effect) --
    // the worktree is still fully intact, clean, and exactly managed.
    const paths = resolveAiqtPaths(implRoot);
    const stateBeforePending = readStateModel(paths.stateFile);
    const interruptedReleasePending = {
      id: "pending-release-interrupted-1",
      type: "release" as const,
      workUnitId: "WU001",
      workspaceId: prepared.workspace!.id,
      workspaceSeriesKey: prepared.workspace!.workspaceSeriesKey,
      generation: prepared.workspace!.generation,
      providerId: "git-worktree@1" as const,
      expectedWorkspacePath: workspacePath,
      expectedBranchName: branchName,
      baseCommit: prepared.workspace!.baseCommit,
      createdAt: T2,
    };
    const stateWithPending = {
      ...stateBeforePending,
      workspace: {
        managedWorkspaces: stateBeforePending.workspace!.managedWorkspaces,
        workspaceBindings: stateBeforePending.workspace!.workspaceBindings,
        pendingWorkspaceOperations: [interruptedReleasePending],
      },
    };
    writeStateModel(paths.stateFile, stateWithPending);

    const preview = recoverWorkspaceOperations({
      paths,
      state: readStateModel(paths.stateFile),
      implementationRoot: implRoot,
      timestamp: T2,
      apply: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.items[0]!.action).toBe("retry_release_only_with_apply");
    expect(preview.items[0]!.applied).toBe(false);
    // Preview must not mutate -- the worktree still exists.
    expect(existsSync(workspacePath)).toBe(true);

    const apply = recoverWorkspaceOperations({
      paths,
      state: readStateModel(paths.stateFile),
      implementationRoot: implRoot,
      timestamp: T2,
      apply: true,
    });
    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect(apply.items[0]!.action).toBe("retry_release_only_with_apply");
    expect(apply.items[0]!.applied).toBe(true);
    expect(existsSync(workspacePath)).toBe(false);

    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace!.pendingWorkspaceOperations).toEqual([]);
    const releasedWorkspace = finalState.workspace!.managedWorkspaces.find((w) => w.id === prepared.workspace!.id)!;
    expect(releasedWorkspace.lifecycleStatus).toBe("released");

    // Branch survives the recovered release.
    const branches = execFileSync("git", ["branch", "--list", branchName], { cwd: implRoot, encoding: "utf8" });
    expect(branches).toContain(branchName.split("/").pop());
  });

  it("recovers an interrupted prepare (pending survives, worktree exists) via --apply, finalizing the workspace", () => {
    const prepared = prepare("WU001", "wu-1");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // Simulate an interruption between §14.1 step 5 (pending persisted) and
    // step 8 (finalize): re-inject a pending prepare for a *second*,
    // genuinely new worktree that was created but never finalized.
    const paths = resolveAiqtPaths(implRoot);
    commitAiqtState("aiqt state after first prepare");

    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);
    const interruptedPath = join(workspaceRoot, "WS-INTERRUPTED");
    mkdirSync(workspaceRoot, { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", "aiqt/p001/wu002-deadbeefcafe", interruptedPath, headSha], {
      cwd: implRoot,
    });

    const stateBeforeRecovery = readStateModel(paths.stateFile);
    const interruptedPending = {
      id: "pending-interrupted-1",
      type: "prepare" as const,
      workUnitId: "WU002",
      workspaceId: "WS-INTERRUPTED",
      workspaceSeriesKey: "series-interrupted",
      generation: 1,
      providerId: "git-worktree@1" as const,
      expectedWorkspacePath: interruptedPath,
      expectedBranchName: "aiqt/p001/wu002-deadbeefcafe",
      baseCommit: headSha,
      createdAt: T1,
      assignmentKey: "wu-2",
      access: "read_write" as const,
    };
    const stateWithInterruptedPending = {
      ...stateBeforeRecovery,
      workspace: {
        managedWorkspaces: stateBeforeRecovery.workspace!.managedWorkspaces,
        workspaceBindings: stateBeforeRecovery.workspace!.workspaceBindings,
        pendingWorkspaceOperations: [interruptedPending],
      },
    };
    writeStateModel(paths.stateFile, stateWithInterruptedPending);

    const preview = recoverWorkspaceOperations({
      paths,
      state: readStateModel(paths.stateFile),
      implementationRoot: implRoot,
      timestamp: T2,
      apply: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]!.action).toBe("finalize_workspace_and_binding");
    expect(preview.items[0]!.applied).toBe(false);
    // Preview must not mutate.
    expect(readStateModel(paths.stateFile).workspace!.pendingWorkspaceOperations).toHaveLength(1);

    const apply = recoverWorkspaceOperations({
      paths,
      state: readStateModel(paths.stateFile),
      implementationRoot: implRoot,
      timestamp: T2,
      apply: true,
    });
    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect(apply.items[0]!.action).toBe("finalize_workspace_and_binding");
    expect(apply.items[0]!.applied).toBe(true);

    const finalState = readStateModel(paths.stateFile);
    expect(finalState.workspace!.pendingWorkspaceOperations).toEqual([]);
    const finalizedWorkspace = finalState.workspace!.managedWorkspaces.find((w) => w.id === "WS-INTERRUPTED")!;
    expect(finalizedWorkspace.lifecycleStatus).toBe("ready");
    const finalizedBinding = finalState.workspace!.workspaceBindings.find((b) => b.workspaceId === "WS-INTERRUPTED")!;
    expect(finalizedBinding.status).toBe("active");
  });

  it("recovery clears a pending prepare that never actually happened (no worktree, no branch)", () => {
    const paths = resolveAiqtPaths(implRoot);
    const state = readStateModel(paths.stateFile);
    const neverHappenedPending = {
      id: "pending-never-1",
      type: "prepare" as const,
      workUnitId: "WU003",
      workspaceId: "WS-NEVER",
      workspaceSeriesKey: "series-never",
      generation: 1,
      providerId: "git-worktree@1" as const,
      expectedWorkspacePath: join(implRoot, "..", "never-existed"),
      expectedBranchName: "aiqt/p001/wu003-neverexisted",
      baseCommit: headSha,
      createdAt: T1,
      assignmentKey: "wu-3",
      access: "read_write" as const,
    };
    const stateWithPending = {
      ...state,
      workspace: {
        managedWorkspaces: state.workspace?.managedWorkspaces ?? [],
        workspaceBindings: state.workspace?.workspaceBindings ?? [],
        pendingWorkspaceOperations: [neverHappenedPending],
      },
    };
    writeStateModel(paths.stateFile, stateWithPending);

    const apply = recoverWorkspaceOperations({
      paths,
      state: readStateModel(paths.stateFile),
      implementationRoot: implRoot,
      timestamp: T2,
      apply: true,
    });
    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect(apply.items[0]!.action).toBe("clear_pending_operation_as_not_applied");
    expect(apply.items[0]!.applied).toBe(true);
    expect(readStateModel(paths.stateFile).workspace!.pendingWorkspaceOperations).toEqual([]);
  });

  it("reprepare after release allocates a genuinely new generation, workspace id, path, and branch, leaving the prior release untouched", () => {
    const first = prepare("WU001", "wu-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    commitAiqtState("aiqt state after first prepare");

    const paths = resolveAiqtPaths(implRoot);
    const release = releaseIsolatedWorkspace({
      paths,
      state: readStateModel(paths.stateFile),
      workUnitId: "WU001",
      implementationRoot: implRoot,
      timestamp: T2,
    });
    expect(release.ok).toBe(true);
    commitAiqtState("aiqt state after release");

    // A second work unit reprepares against the SAME assignment key/base
    // commit -- same logical series, but the first generation is released,
    // so this must allocate generation 2 with a distinct id/path/branch.
    const second = prepare("WU002", "wu-1");
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.workspace!.id).not.toBe(first.workspace!.id);
    expect(second.workspace!.workspacePath).not.toBe(first.workspace!.workspacePath);
    expect(second.workspace!.branchName).not.toBe(first.workspace!.branchName);
    expect(second.workspace!.generation).toBe(2);
    expect(second.workspace!.workspaceSeriesKey).toBe(first.workspace!.workspaceSeriesKey);
    expect(existsSync(second.workspace!.workspacePath)).toBe(true);

    // The prior released record and its branch are completely untouched.
    const finalState = readStateModel(paths.stateFile);
    const priorRecord = finalState.workspace!.managedWorkspaces.find((w) => w.id === first.workspace!.id)!;
    expect(priorRecord.lifecycleStatus).toBe("released");
    expect(priorRecord.generation).toBe(1);
    expect(priorRecord.workspacePath).toBe(first.workspace!.workspacePath);
    expect(priorRecord.branchName).toBe(first.workspace!.branchName);
    const priorBranches = execFileSync("git", ["branch", "--list", first.workspace!.branchName!], {
      cwd: implRoot,
      encoding: "utf8",
    });
    expect(priorBranches).toContain(first.workspace!.branchName!.split("/").pop());
  });
});
