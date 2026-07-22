import { existsSync, mkdirSync, realpathSync } from "node:fs";
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
  gitWorktreeListPorcelain,
  parseGitWorktreeListPorcelain,
  gitCurrentBranch,
  GitRunnerError,
} from "./git-command-runner.js";
import { validateWorkspaceRoot } from "./workspace-path-policy.js";
import {
  planGitWorktreePrepare,
  buildPendingPrepareOperation,
  buildPrepareFinalizeCandidate,
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

/**
 * M25 §10/§14.1: the real (impure) prepare orchestration for
 * `git-worktree@1` -- the first M25 function that actually performs I/O.
 * Reuses `planGitWorktreePrepare` (git-worktree-provider.ts, pure) for
 * the identity/generation decision, the Git runner (WU25-02) for every
 * repository fact and the one fixed mutating command, and
 * `buildPrepareFinalizeCandidate` (pure) for the resulting canonical
 * records. Persists the pending operation BEFORE the Git side effect
 * (§14.1 step 5) and only removes it after independently verifying the
 * resulting worktree (§14.1 step 7-8) -- never before.
 */
export function prepareIsolatedWorkspace(params: PrepareIsolatedWorkspaceParams): PrepareIsolatedWorkspaceResult {
  const warnings: string[] = [];

  if (!gitIsInsideWorkTree(params.implementationRoot)) {
    return { ok: false, category: "invalid", error: "Implementation root is not a valid Git repository." };
  }
  const rootValidation = validateWorkspaceRoot(params.workspaceRoot, params.implementationRoot);
  if (!rootValidation.ok) {
    return { ok: false, category: "invalid", error: `Invalid workspace root: ${rootValidation.reason}` };
  }

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
  const untracked = gitLsFilesOthersExcludeStandard(params.implementationRoot);
  if (!isClean || untracked.length > 0) {
    return {
      ok: false,
      category: "invalid",
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
    return { ok: false, category: "invalid", error: `Failed to create isolated worktree: ${message}` };
  }

  // Compare resolved real paths, not raw strings: on Windows a short (8.3)
  // path segment in `os.tmpdir()`/env-derived roots (e.g. from a non-ASCII
  // username) can differ textually from the long-form path Git reports in
  // `worktree list --porcelain`, even though both refer to the same
  // worktree on disk.
  const listing = parseGitWorktreeListPorcelain(gitWorktreeListPorcelain(params.implementationRoot));
  const expectedRealPath = existsSync(workspacePath) ? realpathSync.native(workspacePath) : null;
  const entry = expectedRealPath
    ? listing.find((e) => existsSync(e.path) && realpathSync.native(e.path) === expectedRealPath)
    : undefined;
  const registered = entry !== undefined;
  const actualBranch = registered ? gitCurrentBranch(workspacePath) : null;
  if (!registered || actualBranch !== branchName) {
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
    assignmentKey: params.assignmentKey,
    access: params.access,
    implementationRoot: params.implementationRoot,
    timestamp: params.timestamp,
    nextEventId: (() => {
      const existingIds = readRunlogEventIds(params.paths.runlogFile);
      const allocated: string[] = [...existingIds];
      return () => {
        const id = nextId("EVT", allocated);
        allocated.push(id);
        return id;
      };
    })(),
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
}
