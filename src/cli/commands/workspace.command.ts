import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import type { Issue } from "../../core/output/issue.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, readRunlogEventIds } from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import type { StateModel } from "../../schema/state.schema.js";
import { resolveRoots } from "../../workflow/root-resolution.js";
import { deriveEffectiveExecutionMetadata } from "../../workflow/execution-metadata-defaults.js";
import {
  getManagedWorkspaces,
  getWorkspaceBindings,
  getPendingWorkspaceOperations,
  findActiveBindingForWorkUnit,
  findManagedWorkspaceById,
} from "../../services/workspace-state-service.js";
import { resolveProviderForWorkspaceMode } from "../../workspaces/workspace-provider-registry.js";
import { deriveDefaultWorkspaceRoot, validateWorkspaceRoot } from "../../workspaces/workspace-path-policy.js";
import {
  gitIsInsideWorkTree,
  gitRevParse,
  gitDiffQuietIsClean,
  gitLsFilesOthersExcludeStandard,
  GitRunnerError,
} from "../../workspaces/git-command-runner.js";
import { inspectIsolatedWorkspace } from "../../workspaces/workspace-inspection.js";
import {
  planGitWorktreePrepare,
  planGitWorktreeRelease,
} from "../../workspaces/git-worktree-provider.js";
import {
  prepareIsolatedWorkspace,
  releaseIsolatedWorkspace,
  untrackedPathsExcludingOperationLock,
} from "../../workspaces/workspace-service.js";
import {
  buildSharedWorkspacePrepareCandidate,
  buildSharedWorkspaceReleaseCandidate,
} from "../../workspaces/shared-repository-provider.js";
import { recoverWorkspaceOperations } from "../../workspaces/workspace-recovery.js";
import { getExecutionSessions, findNonTerminalSessionReferencingWorkspace } from "../../services/execution-session-service.js";
import type { ManagedWorkspace } from "../../schema/managed-workspace.schema.js";

const PREPARE_PROHIBITED_STATUSES = new Set(["planned", "done", "replanned", "cancelled"]);

/**
 * @deprecated M33-WU05: this per-file wrapper now only delegates to the
 * shared familyFailureResult() (M33-WU02) -- prefer calling
 * familyFailureResult() directly in any new code. Retained here only to
 * avoid rewriting every existing call site in this file; not removed
 * because doing so would touch call sites with no behavioral benefit.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "workspace", area: "workspace", summary, exitCode, issueId });
}

function noProjectFailure(): CommandResult {
  return failure(
    "No AIQT project found. Run aiqt init to create the canonical state files.",
    ExitCode.InvalidInput,
    "WORKSPACE-NO-PROJECT",
  );
}

function nextEventIdFactory(runlogFile: string): () => string {
  const existingIds = readRunlogEventIds(runlogFile);
  const allocated: string[] = [...existingIds];
  return () => {
    const id = nextId("EVT", allocated);
    allocated.push(id);
    return id;
  };
}

function isImplementationRootClean(implementationRoot: string): boolean {
  const isClean = gitDiffQuietIsClean(implementationRoot);
  const untracked = untrackedPathsExcludingOperationLock(gitLsFilesOthersExcludeStandard(implementationRoot));
  return isClean && untracked.length === 0;
}

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

export interface RunWorkspacePrepareOptions {
  workUnitId: string;
  preview?: boolean;
}

/**
 * M25 §16.1: `aiqt workspace prepare <work-unit-id>`. Explicit Work Unit ID
 * only -- never an implicit `next` selection, never an arbitrary provider
 * flag. Dispatches to `shared-repository@1` or `git-worktree@1` by the
 * Work Unit's M24-derived effective workspace-assignment mode; `--preview`
 * runs every read-only check without ever creating a directory, branch,
 * worktree, state, or runlog entry.
 */
export function runWorkspacePrepare(ctx: CommandContext, options: RunWorkspacePrepareOptions): CommandResult {
  if (!options.workUnitId) {
    return failure("A work unit ID is required: aiqt workspace prepare <work-unit-id>.", ExitCode.HumanInputRequired, "WORKSPACE-PREPARE-NO-WORK-UNIT");
  }
  if (!aiqtDirExists(ctx)) return noProjectFailure();

  const { paths, project, state } = loadProject(ctx);
  const workUnit = state.workGraph.workUnits.find((wu) => wu.id === options.workUnitId);
  if (!workUnit) {
    return failure(`Work unit ${options.workUnitId} does not exist.`, ExitCode.InvalidInput, "WORKSPACE-PREPARE-UNKNOWN-WORK-UNIT");
  }

  if (PREPARE_PROHIBITED_STATUSES.has(workUnit.status)) {
    return failure(
      `Work unit ${workUnit.id} has status '${workUnit.status}', which is not eligible for workspace preparation (§13).`,
      ExitCode.InvalidInput,
      "WORKSPACE-PREPARE-STATUS-PROHIBITED",
    );
  }

  const existingBindings = getWorkspaceBindings(state);
  const existingBinding = findActiveBindingForWorkUnit(workUnit.id, existingBindings);

  if (workUnit.status === "needs_review" && !existingBinding) {
    return failure(
      `Work unit ${workUnit.id} is 'needs_review' -- it may retain an existing workspace binding but cannot create a new one (§13).`,
      ExitCode.InvalidInput,
      "WORKSPACE-PREPARE-NEEDS-REVIEW-NO-NEW",
    );
  }

  const effective = deriveEffectiveExecutionMetadata(workUnit);
  const mode = effective.workspaceAssignment.mode;
  if (mode === "unknown") {
    return failure(
      `Work unit ${workUnit.id} has no resolved workspace-assignment mode (M24 execution metadata missing or invalid).`,
      ExitCode.InvalidInput,
      "WORKSPACE-PREPARE-UNRESOLVED-MODE",
    );
  }
  if (mode === "none") {
    return failure(
      `Work unit ${workUnit.id} is assigned workspace mode 'none' -- no repository workspace is required or preparable.`,
      ExitCode.InvalidInput,
      "WORKSPACE-PREPARE-MODE-NONE",
    );
  }

  const providerId = resolveProviderForWorkspaceMode(mode);
  const roots = resolveRoots({ controlRoot: ctx.cwd, existingRepositoryPath: project.project.existingRepositoryPath });
  const implementationRoot = roots.implementationRoot;

  if (!gitIsInsideWorkTree(implementationRoot)) {
    return failure("Implementation root is not a valid Git repository.", ExitCode.WorkflowBlocked, "WORKSPACE-PREPARE-NO-GIT-ENV");
  }

  let headCommit: string;
  try {
    headCommit = gitRevParse(implementationRoot, "HEAD");
  } catch (err) {
    const message = err instanceof GitRunnerError ? err.message : "Unable to resolve HEAD commit.";
    return failure(message, ExitCode.WorkflowBlocked, "WORKSPACE-PREPARE-NO-HEAD");
  }

  const assignmentKey = effective.workspaceAssignment.assignmentKey!;
  const access = effective.workspaceAssignment.access!;
  const timestamp = new Date().toISOString();

  if (mode === "shared") {
    return runSharedPrepare({
      paths,
      state,
      projectId: project.project.id,
      workUnitId: workUnit.id,
      assignmentKey,
      access,
      implementationRoot,
      headCommit,
      timestamp,
      preview: Boolean(options.preview),
    });
  }

  // mode === "isolated"
  const workspaceRoot = deriveDefaultWorkspaceRoot(implementationRoot);
  const rootValidation = validateWorkspaceRoot(workspaceRoot, implementationRoot);
  if (!rootValidation.ok) {
    return failure(`Invalid workspace root: ${rootValidation.reason}`, ExitCode.InvalidInput, "WORKSPACE-PREPARE-INVALID-ROOT");
  }

  if (options.preview) {
    const plan = planGitWorktreePrepare({
      state,
      projectId: project.project.id,
      workUnitId: workUnit.id,
      assignmentKey,
      access,
      implementationRoot,
      workspaceRoot,
      headCommit,
    });
    if (!plan.ok) {
      return failure(plan.error, ExitCode.InvalidInput, "WORKSPACE-PREPARE-PLAN-INVALID");
    }
    const clean = isImplementationRootClean(implementationRoot);
    const warnings: Issue[] = clean
      ? []
      : [{ id: "WORKSPACE-PREPARE-PREVIEW-DIRTY", severity: "medium", area: "workspace", message: "The implementation repository has uncommitted changes; applying this prepare would currently be blocked.", agentCanFix: false }];

    if (plan.action.kind === "no_op") {
      return makeResult({
        status: "passed",
        action: "workspace",
        summary: `Preview: work unit ${workUnit.id} already has an active workspace (${plan.action.workspace.id}) -- prepare would be a no-op.`,
        exitCode: ExitCode.Success,
        warnings,
        data: { providerId, outcome: "no_op", workspaceId: plan.action.workspace.id, workspacePath: plan.action.workspace.workspacePath },
      });
    }
    if (plan.action.kind === "recover_pending") {
      return makeResult({
        status: "warning",
        action: "workspace",
        summary: `Preview: a pending prepare operation already exists for work unit ${workUnit.id}. Run 'aiqt workspace recover' before applying.`,
        exitCode: ExitCode.Success,
        warnings,
        data: { providerId, outcome: "recovery_required", pendingOperationId: plan.action.pending.id },
      });
    }
    return makeResult({
      status: warnings.length > 0 ? "warning" : "passed",
      action: "workspace",
      summary: `Preview: prepare would create workspace ${plan.action.workspaceId} on branch ${plan.action.branchName}.`,
      exitCode: ExitCode.Success,
      warnings,
      data: {
        providerId,
        outcome: "would_create",
        workspaceId: plan.action.workspaceId,
        workspacePath: plan.action.workspacePath,
        branchName: plan.action.branchName,
        generation: plan.action.generation,
      },
    });
  }

  const result = prepareIsolatedWorkspace({
    paths,
    state,
    projectId: project.project.id,
    workUnitId: workUnit.id,
    assignmentKey,
    access,
    implementationRoot,
    workspaceRoot,
    headCommit,
    timestamp,
  });

  if (!result.ok) {
    const exitCode = result.category === "blocked" ? ExitCode.WorkflowBlocked : ExitCode.InvalidInput;
    return failure(result.error, exitCode, "WORKSPACE-PREPARE-FAILED");
  }

  const warningIssues: Issue[] = result.warnings.map((message, i) => ({
    id: `WORKSPACE-PREPARE-WARNING-${i + 1}`,
    severity: "low",
    area: "workspace",
    message,
    agentCanFix: false,
  }));

  return makeResult({
    status: warningIssues.length > 0 ? "warning" : "passed",
    action: "workspace",
    summary: `Workspace ${result.outcome} for work unit ${workUnit.id} (${providerId}). This does not start the work unit.`,
    completedActions: result.outcome === "no_op" ? [] : ["Resolved workspace identity", "Created isolated Git worktree", "Wrote state.json", "Appended runlog event(s)"],
    changedFiles: result.outcome === "no_op" ? [] : [paths.stateFile, paths.runlogFile],
    affectedItems: result.workspace ? [result.workspace.id] : [],
    warnings: warningIssues,
    exitCode: ExitCode.Success,
    data: {
      providerId,
      outcome: result.outcome,
      workspaceId: result.workspace?.id,
      workspacePath: result.workspace?.workspacePath,
      branchName: result.workspace?.branchName,
    },
  });
}

function runSharedPrepare(params: {
  paths: ReturnType<typeof loadProject>["paths"];
  state: StateModel;
  projectId: string;
  workUnitId: string;
  assignmentKey: string;
  access: "read_only" | "read_write";
  implementationRoot: string;
  headCommit: string;
  timestamp: string;
  preview: boolean;
}): CommandResult {
  const isDirty = !isImplementationRootClean(params.implementationRoot);
  const nextEventId = params.preview ? (() => "EVT-PREVIEW") : nextEventIdFactory(params.paths.runlogFile);

  const candidate = buildSharedWorkspacePrepareCandidate({
    state: params.state,
    projectId: params.projectId,
    workUnitId: params.workUnitId,
    assignmentKey: params.assignmentKey,
    access: params.access,
    implementationRoot: params.implementationRoot,
    headCommit: params.headCommit,
    isDirty,
    timestamp: params.timestamp,
    nextEventId,
  });

  if (!candidate.ok) {
    return failure(candidate.error, ExitCode.InvalidInput, "WORKSPACE-PREPARE-SHARED-FAILED");
  }

  const warningIssues: Issue[] = candidate.warnings.map((message, i) => ({
    id: `WORKSPACE-PREPARE-WARNING-${i + 1}`,
    severity: "low",
    area: "workspace",
    message,
    agentCanFix: false,
  }));

  if (params.preview) {
    return makeResult({
      status: warningIssues.length > 0 ? "warning" : "passed",
      action: "workspace",
      summary: `Preview: shared-repository prepare would ${candidate.changed ? candidate.outcome : "be a no-op"} for work unit ${params.workUnitId}.`,
      exitCode: ExitCode.Success,
      warnings: warningIssues,
      data: {
        providerId: "shared-repository@1",
        outcome: candidate.changed ? candidate.outcome : "no_op",
        workspaceId: candidate.workspace.id,
        workspacePath: candidate.workspace.workspacePath,
      },
    });
  }

  if (candidate.changed) {
    const finalState: StateModel = {
      ...params.state,
      workspace: {
        managedWorkspaces: candidate.managedWorkspaces,
        workspaceBindings: candidate.workspaceBindings,
        pendingWorkspaceOperations: getPendingWorkspaceOperations(params.state),
      },
    };
    writeStateModel(params.paths.stateFile, finalState);
    for (const event of candidate.runlogEvents) appendRunlogEvent(params.paths.runlogFile, event);
  }

  return makeResult({
    status: warningIssues.length > 0 ? "warning" : "passed",
    action: "workspace",
    summary: `Workspace ${candidate.changed ? candidate.outcome : "no_op"} for work unit ${params.workUnitId} (shared-repository@1). This does not start the work unit.`,
    completedActions: candidate.changed ? ["Resolved shared workspace identity", "Wrote state.json", "Appended runlog event(s)"] : [],
    changedFiles: candidate.changed ? [params.paths.stateFile, params.paths.runlogFile] : [],
    affectedItems: [candidate.workspace.id],
    warnings: warningIssues,
    exitCode: ExitCode.Success,
    data: {
      providerId: "shared-repository@1",
      outcome: candidate.changed ? candidate.outcome : "no_op",
      workspaceId: candidate.workspace.id,
      workspacePath: candidate.workspace.workspacePath,
    },
  });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface RunWorkspaceStatusOptions {
  workUnitId?: string;
}

/** M25 §16.2/§19: read-only. Never mutates state or runlog. */
export function runWorkspaceStatus(ctx: CommandContext, options: RunWorkspaceStatusOptions): CommandResult {
  if (!aiqtDirExists(ctx)) return noProjectFailure();
  const { project, state } = loadProject(ctx);

  const managedWorkspaces = getManagedWorkspaces(state);
  const bindings = getWorkspaceBindings(state);
  const pending = getPendingWorkspaceOperations(state);

  if (options.workUnitId) {
    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === options.workUnitId);
    if (!workUnit) {
      return failure(`Work unit ${options.workUnitId} does not exist.`, ExitCode.InvalidInput, "WORKSPACE-STATUS-UNKNOWN-WORK-UNIT");
    }
    const binding = findActiveBindingForWorkUnit(workUnit.id, bindings);
    if (!binding) {
      return makeResult({
        status: "passed",
        action: "workspace",
        summary: `Work unit ${workUnit.id} has no active managed workspace binding.`,
        exitCode: ExitCode.Success,
        data: { workUnitId: workUnit.id, prepared: false },
      });
    }
    const workspace = findManagedWorkspaceById(binding.workspaceId, managedWorkspaces);
    if (!workspace) {
      return failure(`Binding references unknown workspace ${binding.workspaceId}.`, ExitCode.InvalidInput, "WORKSPACE-STATUS-DANGLING-BINDING");
    }

    let inspection: ReturnType<typeof inspectIsolatedWorkspace> | undefined;
    if (workspace.providerId === "git-worktree@1" && workspace.branchName) {
      const roots = resolveRoots({ controlRoot: ctx.cwd, existingRepositoryPath: project.project.existingRepositoryPath });
      if (gitIsInsideWorkTree(roots.implementationRoot)) {
        inspection = inspectIsolatedWorkspace({
          implementationRoot: roots.implementationRoot,
          workspacePath: workspace.workspacePath,
          expectedBranch: workspace.branchName,
        });
      }
    }

    return makeResult({
      status: "passed",
      action: "workspace",
      summary: `Work unit ${workUnit.id} is bound to workspace ${workspace.id} (${workspace.providerId}, ${workspace.lifecycleStatus}).`,
      exitCode: ExitCode.Success,
      data: {
        workUnitId: workUnit.id,
        prepared: true,
        workspaceId: workspace.id,
        providerId: workspace.providerId,
        workspaceMode: workspace.mode,
        workspacePath: workspace.workspacePath,
        branchName: workspace.branchName,
        lifecycleStatus: workspace.lifecycleStatus,
        inspection,
      },
    });
  }

  const preparedCount = managedWorkspaces.filter((w: ManagedWorkspace) => w.lifecycleStatus === "ready").length;
  const releasedCount = managedWorkspaces.filter((w: ManagedWorkspace) => w.lifecycleStatus === "released").length;

  return makeResult({
    status: pending.length > 0 ? "warning" : "passed",
    action: "workspace",
    summary: `${managedWorkspaces.length} managed workspace(s): ${preparedCount} ready, ${releasedCount} released, ${pending.length} pending recovery.`,
    warnings: pending.length > 0
      ? [{ id: "WORKSPACE-STATUS-PENDING-RECOVERY", severity: "medium", area: "workspace", message: `${pending.length} pending workspace operation(s) require 'aiqt workspace recover'.`, agentCanFix: false }]
      : [],
    exitCode: ExitCode.Success,
    data: {
      totalWorkspaces: managedWorkspaces.length,
      ready: preparedCount,
      released: releasedCount,
      pendingRecovery: pending.length,
      workspaces: managedWorkspaces.map((w) => ({
        id: w.id,
        providerId: w.providerId,
        mode: w.mode,
        lifecycleStatus: w.lifecycleStatus,
        generation: w.generation,
        assignmentKey: w.assignmentKey,
      })),
    },
  });
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export interface RunWorkspaceReleaseOptions {
  workUnitId: string;
  preview?: boolean;
}

/** M25 §16.3/§12/§14.2: `aiqt workspace release <work-unit-id>`. */
export function runWorkspaceRelease(ctx: CommandContext, options: RunWorkspaceReleaseOptions): CommandResult {
  if (!options.workUnitId) {
    return failure("A work unit ID is required: aiqt workspace release <work-unit-id>.", ExitCode.HumanInputRequired, "WORKSPACE-RELEASE-NO-WORK-UNIT");
  }
  if (!aiqtDirExists(ctx)) return noProjectFailure();

  const { paths, project, state } = loadProject(ctx);
  const bindings = getWorkspaceBindings(state);
  const binding = findActiveBindingForWorkUnit(options.workUnitId, bindings);

  if (!binding) {
    return makeResult({
      status: "passed",
      action: "workspace",
      summary: `Work unit ${options.workUnitId} has no active workspace binding to release (no-op).`,
      exitCode: ExitCode.Success,
      data: { outcome: "no_op" },
    });
  }

  const workspace = findManagedWorkspaceById(binding.workspaceId, getManagedWorkspaces(state));
  if (!workspace) {
    return failure(`Binding references unknown workspace ${binding.workspaceId}.`, ExitCode.InvalidInput, "WORKSPACE-RELEASE-DANGLING-BINDING");
  }

  const roots = resolveRoots({ controlRoot: ctx.cwd, existingRepositoryPath: project.project.existingRepositoryPath });
  const implementationRoot = roots.implementationRoot;
  const timestamp = new Date().toISOString();

  // M26 §5.2: a non-terminal execution session referencing this managed
  // workspace blocks release for either provider; terminal sessions do
  // not. Checked once here so both the shared and isolated dispatch
  // branches below are covered without preview/apply divergence.
  const blockingSession = findNonTerminalSessionReferencingWorkspace(workspace.id, getExecutionSessions(state));
  if (blockingSession && !options.preview) {
    return failure(
      `Execution session ${blockingSession.id} (status "${blockingSession.status}") still references workspace ${workspace.id}.`,
      ExitCode.WorkflowBlocked,
      "WORKSPACE-RELEASE-EXECUTION-SESSION-BLOCKING",
    );
  }

  if (workspace.providerId === "shared-repository@1") {
    const nextEventId = options.preview ? (() => "EVT-PREVIEW") : nextEventIdFactory(paths.runlogFile);
    const candidate = buildSharedWorkspaceReleaseCandidate({
      state,
      workUnitId: options.workUnitId,
      timestamp,
      nextEventId,
    });
    if (!candidate.ok) {
      return failure(candidate.error, ExitCode.InvalidInput, "WORKSPACE-RELEASE-SHARED-FAILED");
    }

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "workspace",
        summary: `Preview: release would ${candidate.changed ? "release" : "be a no-op for"} work unit ${options.workUnitId}'s shared binding.`,
        exitCode: ExitCode.Success,
        data: { providerId: "shared-repository@1", outcome: candidate.changed ? "released" : "no_op" },
      });
    }

    if (candidate.changed) {
      const finalState: StateModel = {
        ...state,
        workspace: {
          managedWorkspaces: candidate.managedWorkspaces,
          workspaceBindings: candidate.workspaceBindings,
          pendingWorkspaceOperations: getPendingWorkspaceOperations(state),
        },
      };
      writeStateModel(paths.stateFile, finalState);
      for (const event of candidate.runlogEvents) appendRunlogEvent(paths.runlogFile, event);
    }

    return makeResult({
      status: "passed",
      action: "workspace",
      summary: `Shared workspace binding ${candidate.changed ? "released" : "already released (no-op)"} for work unit ${options.workUnitId}.`,
      completedActions: candidate.changed ? ["Wrote state.json", "Appended runlog event(s)"] : [],
      changedFiles: candidate.changed ? [paths.stateFile, paths.runlogFile] : [],
      affectedItems: [workspace.id],
      exitCode: ExitCode.Success,
      data: { providerId: "shared-repository@1", outcome: candidate.changed ? "released" : "no_op" },
    });
  }

  // git-worktree@1
  if (options.preview) {
    if (!gitIsInsideWorkTree(implementationRoot)) {
      return failure("Implementation root is not a valid Git repository.", ExitCode.WorkflowBlocked, "WORKSPACE-RELEASE-NO-GIT-ENV");
    }
    const plan = planGitWorktreeRelease({ state, workUnitId: options.workUnitId });
    if (!plan.ok) {
      return failure(plan.error, ExitCode.InvalidInput, "WORKSPACE-RELEASE-PLAN-INVALID");
    }
    if (plan.action.kind !== "release") {
      return makeResult({
        status: "passed",
        action: "workspace",
        summary: `Preview: release for work unit ${options.workUnitId} would be a no-op or requires recovery first.`,
        exitCode: ExitCode.Success,
        data: { providerId: "git-worktree@1", outcome: plan.action.kind },
      });
    }
    const inspection = workspace.branchName
      ? inspectIsolatedWorkspace({ implementationRoot, workspacePath: workspace.workspacePath, expectedBranch: workspace.branchName })
      : undefined;
    const dirty = inspection ? !inspection.clean || inspection.hasUnresolvedConflict : false;
    return makeResult({
      status: dirty ? "warning" : "passed",
      action: "workspace",
      summary: `Preview: release would remove worktree ${workspace.workspacePath}${dirty ? " -- currently dirty, would be blocked" : ""}.`,
      warnings: dirty
        ? [{ id: "WORKSPACE-RELEASE-PREVIEW-DIRTY", severity: "medium", area: "workspace", message: "The isolated worktree is dirty; applying this release would currently be blocked.", agentCanFix: false }]
        : [],
      exitCode: ExitCode.Success,
      data: { providerId: "git-worktree@1", outcome: "would_release", workspaceId: workspace.id, workspacePath: workspace.workspacePath },
    });
  }

  const result = releaseIsolatedWorkspace({ paths, state, workUnitId: options.workUnitId, implementationRoot, timestamp });
  if (!result.ok) {
    const exitCode = result.category === "blocked" ? ExitCode.WorkflowBlocked : ExitCode.InvalidInput;
    return failure(result.error, exitCode, "WORKSPACE-RELEASE-FAILED");
  }

  return makeResult({
    status: "passed",
    action: "workspace",
    summary: `Workspace ${result.outcome} for work unit ${options.workUnitId} (git-worktree@1).`,
    completedActions: result.outcome === "no_op" ? [] : ["Removed isolated Git worktree", "Wrote state.json", "Appended runlog event(s)"],
    changedFiles: result.outcome === "no_op" ? [] : [paths.stateFile, paths.runlogFile],
    affectedItems: [workspace.id],
    exitCode: ExitCode.Success,
    data: { providerId: "git-worktree@1", outcome: result.outcome },
  });
}

// ---------------------------------------------------------------------------
// Recover
// ---------------------------------------------------------------------------

export interface RunWorkspaceRecoverOptions {
  apply?: boolean;
}

/** M25 §15/§16.4: `aiqt workspace recover [--apply]`. Default (no --apply) is preview. */
export function runWorkspaceRecover(ctx: CommandContext, options: RunWorkspaceRecoverOptions): CommandResult {
  if (!aiqtDirExists(ctx)) return noProjectFailure();
  const { paths, project, state } = loadProject(ctx);
  const roots = resolveRoots({ controlRoot: ctx.cwd, existingRepositoryPath: project.project.existingRepositoryPath });
  const timestamp = new Date().toISOString();

  const result = recoverWorkspaceOperations({
    paths,
    state,
    implementationRoot: roots.implementationRoot,
    timestamp,
    apply: Boolean(options.apply),
  });

  if (!result.ok) {
    return failure(result.error, ExitCode.WorkflowBlocked, "WORKSPACE-RECOVER-LOCK-FAILED");
  }

  const blockedItems = result.items.filter((item) => item.action === "blocked_manual_recovery");
  const exitCode = options.apply && blockedItems.length > 0 ? ExitCode.WorkflowBlocked : ExitCode.Success;

  return makeResult({
    status: blockedItems.length > 0 ? "warning" : "passed",
    action: "workspace",
    summary: options.apply
      ? `Recovery applied: ${result.items.length} pending operation(s) processed, ${blockedItems.length} require manual intervention.`
      : `Recovery preview: ${result.items.length} pending operation(s) found, ${blockedItems.length} would require manual intervention.`,
    warnings: blockedItems.map((item, i) => ({
      id: `WORKSPACE-RECOVER-BLOCKED-${i + 1}`,
      severity: "high" as const,
      area: "workspace",
      message: `Pending ${item.type} operation on workspace ${item.workspaceId} requires manual recovery: ${item.reason ?? "unspecified"}`,
      agentCanFix: false,
    })),
    changedFiles: options.apply && result.items.some((i) => i.applied) ? [paths.stateFile, paths.runlogFile] : [],
    exitCode,
    data: { apply: Boolean(options.apply), items: result.items },
  });
}
