import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { AiqtPaths } from "../core/filesystem/paths.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ManagedWorkspace, ManagedWorkspaceAccess } from "../schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../schema/workspace-binding.schema.js";
import { writeStateModel } from "../state/workflow-state-store.js";
import { appendRunlogEvent, readRunlogEventIds } from "../state/runlog-store.js";
import { nextId } from "../state/ids.js";
import { getManagedWorkspaces, getWorkspaceBindings, getPendingWorkspaceOperations } from "../services/workspace-state-service.js";
import {
  gitIsInsideWorkTree,
  gitDiffQuietIsClean,
  gitLsFilesOthersExcludeStandard,
  gitWorktreeAdd,
  gitWorktreeRemove,
  GitRunnerError,
} from "./git-command-runner.js";
import { validateWorkspaceRoot } from "./workspace-path-policy.js";
import { inspectIsolatedWorkspace } from "./workspace-inspection.js";
import {
  acquireWorkspaceOperationLock,
  WorkspaceOperationLockError,
  WORKSPACE_OPERATION_LOCK_FILE_NAME,
} from "./workspace-operation-lock.js";

/**
 * The lock file lives inside `.aiqt/` (§20) but is a transient runtime
 * artifact -- like `.aiqt/exports`, it is never meant to be committed --
 * so its own untracked presence must not trip the "implementation
 * repository working tree is clean" precondition (§10.1) while a
 * workspace operation holds it.
 */
export function untrackedPathsExcludingOperationLock(untracked: readonly string[]): string[] {
  const lockRelativePath = `.aiqt/${WORKSPACE_OPERATION_LOCK_FILE_NAME}`;
  return untracked.filter((path) => path !== lockRelativePath);
}
import {
  planGitWorktreePrepare,
  buildPendingPrepareOperation,
  buildPrepareFinalizeCandidate,
  planGitWorktreeRelease,
  buildPendingReleaseOperation,
  buildReleaseFinalizeCandidate,
} from "./git-worktree-provider.js";

export type PrepareOutcome = "created" | "linked" | "no_op" | "recovery_required";

export interface PrepareIsolatedWorkspaceParams {
  paths: AiqtPaths;
  state: StateModel;
  projectId: string;
  workUnitId: string;
  assignmentKey: string;
  access: ManagedWorkspaceAccess;
  implementationRoot: string;
  workspaceRoot: string;
  headCommit: string;
  timestamp: string;
}

export interface PrepareIsolatedWorkspaceSuccess {
  ok: true;
  outcome: PrepareOutcome;
  workspace?: ManagedWorkspace;
  binding?: WorkspaceBinding;
  warnings: string[];
}

export interface PrepareIsolatedWorkspaceFailure {
  ok: false;
  /** "invalid" (exit 3) or "blocked" (exit 2). */
  category: "invalid" | "blocked";
  error: string;
}

export type PrepareIsolatedWorkspaceResult = PrepareIsolatedWorkspaceSuccess | PrepareIsolatedWorkspaceFailure;

function nextEventIdFactory(runlogFile: string): () => string {
  const existingIds = readRunlogEventIds(runlogFile);
  const allocated: string[] = [...existingIds];
  return () => {
    const id = nextId("EVT", allocated);
    allocated.push(id);
    return id;
  };
}

/**
 * M25 §10/§14.1/§20: the real (impure) prepare orchestration for
 * `git-worktree@1` -- the first M25 function that actually performs I/O.
 * Reuses `planGitWorktreePrepare` (git-worktree-provider.ts, pure) for
 * the identity/generation decision, the Git runner (WU25-02) for every
 * repository fact and the one fixed mutating command, and
 * `buildPrepareFinalizeCandidate` (pure) for the resulting canonical
 * records. Persists the pending operation BEFORE the Git side effect
 * (§14.1 step 5) and only removes it after independently verifying the
 * resulting worktree (§14.1 step 7-8) -- never before. Generation
 * resolution through finalization runs under the workspace-operation
 * lock (§20) so two concurrent prepares can never race on the same
 * series.
 */
export function prepareIsolatedWorkspace(params: PrepareIsolatedWorkspaceParams): PrepareIsolatedWorkspaceResult {
  const warnings: string[] = [];

  if (!gitIsInsideWorkTree(params.implementationRoot)) {
    // §16.5: "unavailable Git environment" is exit 2 (blocked), not exit 3
    // (invalid) -- the implementation root itself may be fine, just not a
    // Git repository right now (e.g. not yet initialized).
    return { ok: false, category: "blocked", error: "Implementation root is not a valid Git repository." };
  }
  const rootValidation = validateWorkspaceRoot(params.workspaceRoot, params.implementationRoot);
  if (!rootValidation.ok) {
    return { ok: false, category: "invalid", error: `Invalid workspace root: ${rootValidation.reason}` };
  }

  let lock;
  try {
    lock = acquireWorkspaceOperationLock(params.paths.aiqtDir, `prepare:${params.workUnitId}:${randomUUID()}`);
  } catch (err) {
    const message = err instanceof WorkspaceOperationLockError ? err.message : "Failed to acquire workspace operation lock.";
    return { ok: false, category: "blocked", error: message };
  }

  try {
    const plan = planGitWorktreePrepare({
      state: params.state,
      projectId: params.projectId,
      workUnitId: params.workUnitId,
      assignmentKey: params.assignmentKey,
      access: params.access,
      implementationRoot: params.implementationRoot,
      workspaceRoot: params.workspaceRoot,
      headCommit: params.headCommit,
    });
    if (!plan.ok) {
      return { ok: false, category: "invalid", error: plan.error };
    }

    if (plan.action.kind === "no_op") {
      return { ok: true, outcome: "no_op", workspace: plan.action.workspace, binding: plan.action.binding, warnings };
    }

    if (plan.action.kind === "recover_pending") {
      return {
        ok: false,
        category: "blocked",
        error: `A pending prepare operation already exists for work unit ${params.workUnitId}. Run 'aiqt workspace recover' before retrying.`,
      };
    }

    // plan.action.kind === "prepare_new"
    const { workspaceId, workspaceSeriesKey, generation, workspacePath, branchName } = plan.action;

    const isClean = gitDiffQuietIsClean(params.implementationRoot);
    const untracked = untrackedPathsExcludingOperationLock(gitLsFilesOthersExcludeStandard(params.implementationRoot));
    if (!isClean || untracked.length > 0) {
      // §16.5: "dirty workspace" is exit 2 (blocked), not exit 3 (invalid).
      return {
        ok: false,
        category: "blocked",
        error: "Implementation repository working tree is not clean (tracked or untracked changes present).",
      };
    }

    if (existsSync(workspacePath)) {
      return {
        ok: false,
        category: "invalid",
        error: `Target workspace path already exists and is not managed by this workspace instance: ${workspacePath}`,
      };
    }

    const pending = buildPendingPrepareOperation({
      workUnitId: params.workUnitId,
      workspaceId,
      workspaceSeriesKey,
      generation,
      workspacePath,
      branchName,
      baseCommit: params.headCommit,
      timestamp: params.timestamp,
      assignmentKey: params.assignmentKey,
      access: params.access,
    });

    // §14.1 step 5: persist the pending operation BEFORE any Git side effect.
    const stateWithPending: StateModel = {
      ...params.state,
      workspace: {
        managedWorkspaces: getManagedWorkspaces(params.state),
        workspaceBindings: getWorkspaceBindings(params.state),
        pendingWorkspaceOperations: [...getPendingWorkspaceOperations(params.state), pending],
      },
    };
    writeStateModel(params.paths.stateFile, stateWithPending);

    try {
      if (!existsSync(params.workspaceRoot)) {
        mkdirSync(params.workspaceRoot, { recursive: true });
      } else if (!existsSync(dirname(workspacePath))) {
        mkdirSync(dirname(workspacePath), { recursive: true });
      }
      gitWorktreeAdd(params.implementationRoot, branchName, workspacePath, params.headCommit);
    } catch (err) {
      // §14.3: no side effect proven to have occurred (worktree add failed
      // outright) -- safe to remove the pending marker we just wrote.
      const cleanupState: StateModel = {
        ...stateWithPending,
        workspace: {
          ...stateWithPending.workspace!,
          pendingWorkspaceOperations: getPendingWorkspaceOperations(stateWithPending).filter(
            (p) => p.id !== pending.id,
          ),
        },
      };
      writeStateModel(params.paths.stateFile, cleanupState);
      const message = err instanceof GitRunnerError ? err.message : "Git worktree creation failed.";
      // §14.3/§16.5: a provider-side-effect failure is an environment/
      // provider blockage (exit 2), not an invalid canonical state (exit 3).
      return { ok: false, category: "blocked", error: `Failed to create isolated worktree: ${message}` };
    }

    const inspection = inspectIsolatedWorkspace({
      implementationRoot: params.implementationRoot,
      workspacePath,
      expectedBranch: branchName,
    });
    if (!inspection.registered || !inspection.branchMatches) {
      // §14.3: side effect may have occurred but verification failed --
      // the pending operation MUST be preserved; recovery is required.
      return {
        ok: false,
        category: "blocked",
        error: "Worktree creation could not be verified. Run 'aiqt workspace recover' to reconcile.",
      };
    }

    const finalized = buildPrepareFinalizeCandidate({
      state: stateWithPending,
      pending,
      implementationRoot: params.implementationRoot,
      timestamp: params.timestamp,
      nextEventId: nextEventIdFactory(params.paths.runlogFile),
    });

    const finalState: StateModel = {
      ...stateWithPending,
      workspace: {
        managedWorkspaces: finalized.managedWorkspaces,
        workspaceBindings: finalized.workspaceBindings,
        pendingWorkspaceOperations: finalized.pendingWorkspaceOperations,
      },
    };
    writeStateModel(params.paths.stateFile, finalState);
    for (const event of finalized.runlogEvents) {
      appendRunlogEvent(params.paths.runlogFile, event);
    }

    return { ok: true, outcome: "created", workspace: finalized.workspace, binding: finalized.binding, warnings };
  } finally {
    lock.release();
  }
}

export type ReleaseOutcome = "released" | "no_op";

export interface ReleaseIsolatedWorkspaceParams {
  paths: AiqtPaths;
  state: StateModel;
  workUnitId: string;
  implementationRoot: string;
  timestamp: string;
}

export interface ReleaseIsolatedWorkspaceSuccess {
  ok: true;
  outcome: ReleaseOutcome;
}

export interface ReleaseIsolatedWorkspaceFailure {
  ok: false;
  /** "invalid" (exit 3) or "blocked" (exit 2). */
  category: "invalid" | "blocked";
  error: string;
}

export type ReleaseIsolatedWorkspaceResult = ReleaseIsolatedWorkspaceSuccess | ReleaseIsolatedWorkspaceFailure;

/**
 * M25 §12.2/§14.2/§20: the real (impure) release orchestration for
 * `git-worktree@1`. Persists the pending release operation BEFORE the
 * `git worktree remove` side effect, never passes `--force`, never
 * deletes the branch, and never removes a dirty or unmanaged path.
 * Verification and mutation run under the workspace-operation lock.
 */
export function releaseIsolatedWorkspace(params: ReleaseIsolatedWorkspaceParams): ReleaseIsolatedWorkspaceResult {
  if (!gitIsInsideWorkTree(params.implementationRoot)) {
    return { ok: false, category: "blocked", error: "Implementation root is not a valid Git repository." };
  }

  let lock;
  try {
    lock = acquireWorkspaceOperationLock(params.paths.aiqtDir, `release:${params.workUnitId}:${randomUUID()}`);
  } catch (err) {
    const message = err instanceof WorkspaceOperationLockError ? err.message : "Failed to acquire workspace operation lock.";
    return { ok: false, category: "blocked", error: message };
  }

  try {
    const plan = planGitWorktreeRelease({ state: params.state, workUnitId: params.workUnitId });
    if (!plan.ok) {
      return { ok: false, category: "invalid", error: plan.error };
    }
    if (plan.action.kind === "no_op") {
      return { ok: true, outcome: "no_op" };
    }
    if (plan.action.kind === "recover_pending") {
      return {
        ok: false,
        category: "blocked",
        error: `A pending release operation already exists for workspace ${plan.action.pending.workspaceId}. Run 'aiqt workspace recover' before retrying.`,
      };
    }

    // plan.action.kind === "release"
    const { workspace } = plan.action;
    if (!workspace.branchName) {
      return { ok: false, category: "invalid", error: `Workspace ${workspace.id} has no recorded branch name.` };
    }

    const preInspection = inspectIsolatedWorkspace({
      implementationRoot: params.implementationRoot,
      workspacePath: workspace.workspacePath,
      expectedBranch: workspace.branchName,
    });
    if (preInspection.exists && preInspection.registered) {
      // §12.2/§16.5: drift and dirtiness are both exit 2 (blocked), not
      // exit 3 -- the canonical record itself is not invalid, the
      // physical workspace just isn't in a releasable state right now.
      if (!preInspection.branchMatches) {
        return { ok: false, category: "blocked", error: `Workspace ${workspace.id} has drifted from its recorded branch.` };
      }
      if (!preInspection.clean || preInspection.hasUnresolvedConflict) {
        return { ok: false, category: "blocked", error: `Workspace ${workspace.id} is not clean; release requires a clean worktree.` };
      }
    }

    const pending = buildPendingReleaseOperation({
      workUnitId: params.workUnitId,
      workspace,
      timestamp: params.timestamp,
    });

    // §14.2 step 2: persist the pending release operation BEFORE any Git side effect.
    const stateWithPending: StateModel = {
      ...params.state,
      workspace: {
        managedWorkspaces: getManagedWorkspaces(params.state),
        workspaceBindings: getWorkspaceBindings(params.state),
        pendingWorkspaceOperations: [...getPendingWorkspaceOperations(params.state), pending],
      },
    };
    writeStateModel(params.paths.stateFile, stateWithPending);

    if (preInspection.exists && preInspection.registered) {
      try {
        gitWorktreeRemove(params.implementationRoot, workspace.workspacePath);
      } catch (err) {
        // §14.3: no side effect proven to have occurred -- safe to remove
        // the pending marker we just wrote.
        const cleanupState: StateModel = {
          ...stateWithPending,
          workspace: {
            ...stateWithPending.workspace!,
            pendingWorkspaceOperations: getPendingWorkspaceOperations(stateWithPending).filter(
              (p) => p.id !== pending.id,
            ),
          },
        };
        writeStateModel(params.paths.stateFile, cleanupState);
        const message = err instanceof GitRunnerError ? err.message : "Git worktree removal failed.";
        return { ok: false, category: "blocked", error: `Failed to remove isolated worktree: ${message}` };
      }
    }

    const postInspection = inspectIsolatedWorkspace({
      implementationRoot: params.implementationRoot,
      workspacePath: workspace.workspacePath,
      expectedBranch: workspace.branchName,
    });
    if (postInspection.exists || postInspection.registered) {
      // §14.3: the removal cannot be verified -- preserve the pending
      // operation and require recovery rather than guessing.
      return {
        ok: false,
        category: "blocked",
        error: "Worktree removal could not be verified. Run 'aiqt workspace recover' to reconcile.",
      };
    }

    const finalized = buildReleaseFinalizeCandidate({
      state: stateWithPending,
      pending,
      timestamp: params.timestamp,
      nextEventId: nextEventIdFactory(params.paths.runlogFile),
    });

    const finalState: StateModel = {
      ...stateWithPending,
      workspace: {
        managedWorkspaces: finalized.managedWorkspaces,
        workspaceBindings: finalized.workspaceBindings,
        pendingWorkspaceOperations: finalized.pendingWorkspaceOperations,
      },
    };
    writeStateModel(params.paths.stateFile, finalState);
    for (const event of finalized.runlogEvents) {
      appendRunlogEvent(params.paths.runlogFile, event);
    }

    return { ok: true, outcome: "released" };
  } finally {
    lock.release();
  }
}
