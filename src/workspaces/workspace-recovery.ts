import type { AiqtPaths } from "../core/filesystem/paths.js";
import type { StateModel } from "../schema/state.schema.js";
import type { PendingWorkspaceOperation } from "../schema/pending-workspace-operation.schema.js";
import { writeStateModel } from "../state/workflow-state-store.js";
import { appendRunlogEvent, readRunlogEventIds } from "../state/runlog-store.js";
import { nextId } from "../state/ids.js";
import { getPendingWorkspaceOperations } from "../services/workspace-state-service.js";
import { inspectIsolatedWorkspace, type IsolatedWorkspaceInspection } from "./workspace-inspection.js";
import { acquireWorkspaceOperationLock, WorkspaceOperationLockError } from "./workspace-operation-lock.js";
import { buildPrepareFinalizeCandidate, buildReleaseFinalizeCandidate } from "./git-worktree-provider.js";
import { gitWorktreeRemove, GitRunnerError } from "./git-command-runner.js";
import {
  buildWorkspaceRecoveryCompletedEvent,
  buildWorkspaceRecoveryBlockedEvent,
} from "../state/runlog-store.js";

/**
 * M25 §15: recovery decisions depend only on the canonical pending
 * operation record plus a fresh physical inspection -- never on
 * assumptions about what "probably" happened. Pure planning functions
 * below take an already-computed inspection so they stay independently
 * testable without spawning Git.
 */
export type PrepareRecoveryAction =
  | { kind: "finalize_workspace_and_binding" }
  | { kind: "clear_pending_operation_as_not_applied" }
  | { kind: "blocked_manual_recovery"; reason: string };

/** M25 §15.1. */
export function planPrepareRecovery(inspection: IsolatedWorkspaceInspection): PrepareRecoveryAction {
  if (inspection.exists && inspection.registered && inspection.branchMatches) {
    return { kind: "finalize_workspace_and_binding" };
  }
  if (!inspection.exists && !inspection.registered) {
    return { kind: "clear_pending_operation_as_not_applied" };
  }
  return {
    kind: "blocked_manual_recovery",
    reason: "Physical result conflicts with the reserved path/branch -- manual recovery required.",
  };
}

export type ReleaseRecoveryAction =
  | { kind: "finalize_release" }
  | { kind: "retry_release_only_with_apply" }
  | { kind: "blocked_manual_recovery"; reason: string };

/** M25 §15.2. */
export function planReleaseRecovery(inspection: IsolatedWorkspaceInspection): ReleaseRecoveryAction {
  if (!inspection.exists && !inspection.registered) {
    return { kind: "finalize_release" };
  }
  if (inspection.exists && inspection.registered && inspection.branchMatches && inspection.clean && !inspection.hasUnresolvedConflict) {
    return { kind: "retry_release_only_with_apply" };
  }
  return {
    kind: "blocked_manual_recovery",
    reason: "Workspace is dirty or has drifted from its canonical branch -- manual recovery required.",
  };
}

export interface RecoveryItemReport {
  pendingOperationId: string;
  workspaceId: string;
  workUnitId: string;
  type: "prepare" | "release";
  action:
    | "finalize_workspace_and_binding"
    | "clear_pending_operation_as_not_applied"
    | "finalize_release"
    | "retry_release_only_with_apply"
    | "blocked_manual_recovery";
  reason?: string;
  applied: boolean;
}

export interface RecoverWorkspaceOperationsParams {
  paths: AiqtPaths;
  state: StateModel;
  implementationRoot: string;
  timestamp: string;
  /** Preview (default) performs no mutation; apply performs the recovery action. */
  apply: boolean;
}

export interface RecoverWorkspaceOperationsResult {
  ok: true;
  items: RecoveryItemReport[];
}

export interface RecoverWorkspaceOperationsFailure {
  ok: false;
  category: "blocked";
  error: string;
}

/**
 * M25 §15/§20: inspects every canonical pending operation against
 * physical reality and, in `--apply` mode, performs the deterministic
 * recovery action under the workspace-operation lock. `--preview`
 * (the default) never mutates state or runlog. Only `git-worktree@1`
 * ever produces a pending operation (§9's design note in
 * shared-repository-provider.ts), so every item here is inspected via
 * the isolated-workspace inspector.
 */
export function recoverWorkspaceOperations(
  params: RecoverWorkspaceOperationsParams,
): RecoverWorkspaceOperationsResult | RecoverWorkspaceOperationsFailure {
  const pendingOps = getPendingWorkspaceOperations(params.state);
  const items: RecoveryItemReport[] = [];

  if (pendingOps.length === 0) {
    return { ok: true, items };
  }

  let lock;
  if (params.apply) {
    try {
      lock = acquireWorkspaceOperationLock(params.paths.aiqtDir, `recover:${Date.now()}`);
    } catch (err) {
      const message = err instanceof WorkspaceOperationLockError ? err.message : "Failed to acquire workspace operation lock.";
      return { ok: false, category: "blocked", error: message };
    }
  }

  try {
    let workingState = params.state;
    const nextEventId = (() => {
      const existingIds = readRunlogEventIds(params.paths.runlogFile);
      const allocated: string[] = [...existingIds];
      return () => {
        const id = nextId("EVT", allocated);
        allocated.push(id);
        return id;
      };
    })();

    for (const pending of getPendingWorkspaceOperations(workingState)) {
      const item = recoverOnePendingOperation({
        pending,
        implementationRoot: params.implementationRoot,
        timestamp: params.timestamp,
        apply: params.apply,
        state: workingState,
        paths: params.paths,
        nextEventId,
      });
      items.push(item.report);
      if (item.nextState) workingState = item.nextState;
    }

    return { ok: true, items };
  } finally {
    lock?.release();
  }
}

function recoverOnePendingOperation(input: {
  pending: PendingWorkspaceOperation;
  implementationRoot: string;
  timestamp: string;
  apply: boolean;
  state: StateModel;
  paths: AiqtPaths;
  nextEventId: () => string;
}): { report: RecoveryItemReport; nextState?: StateModel } {
  const { pending } = input;
  const expectedBranch = pending.expectedBranchName;

  if (!expectedBranch) {
    const report: RecoveryItemReport = {
      pendingOperationId: pending.id,
      workspaceId: pending.workspaceId,
      workUnitId: pending.workUnitId,
      type: pending.type,
      action: "blocked_manual_recovery",
      reason: "Pending operation has no recorded branch name.",
      applied: false,
    };
    return { report };
  }

  const inspection = inspectIsolatedWorkspace({
    implementationRoot: input.implementationRoot,
    workspacePath: pending.expectedWorkspacePath,
    expectedBranch,
  });

  if (pending.type === "prepare") {
    const decision = planPrepareRecovery(inspection);
    const report: RecoveryItemReport = {
      pendingOperationId: pending.id,
      workspaceId: pending.workspaceId,
      workUnitId: pending.workUnitId,
      type: "prepare",
      action: decision.kind,
      reason: decision.kind === "blocked_manual_recovery" ? decision.reason : undefined,
      applied: false,
    };

    if (!input.apply) return { report };

    if (decision.kind === "finalize_workspace_and_binding") {
      const finalized = buildPrepareFinalizeCandidate({
        state: input.state,
        pending,
        implementationRoot: input.implementationRoot,
        timestamp: input.timestamp,
        nextEventId: input.nextEventId,
      });
      const nextState: StateModel = {
        ...input.state,
        workspace: {
          managedWorkspaces: finalized.managedWorkspaces,
          workspaceBindings: finalized.workspaceBindings,
          pendingWorkspaceOperations: finalized.pendingWorkspaceOperations,
        },
      };
      writeStateModel(input.paths.stateFile, nextState);
      for (const event of finalized.runlogEvents) appendRunlogEvent(input.paths.runlogFile, event);
      appendRunlogEvent(
        input.paths.runlogFile,
        buildWorkspaceRecoveryCompletedEvent({
          id: input.nextEventId(),
          timestamp: input.timestamp,
          relatedIds: [pending.workspaceId],
          data: { pendingOperationId: pending.id, workspaceId: pending.workspaceId, operationType: "prepare", action: decision.kind },
        }),
      );
      return { report: { ...report, applied: true }, nextState };
    }

    if (decision.kind === "clear_pending_operation_as_not_applied") {
      const nextState: StateModel = {
        ...input.state,
        workspace: {
          ...input.state.workspace!,
          pendingWorkspaceOperations: getPendingWorkspaceOperations(input.state).filter((p) => p.id !== pending.id),
        },
      };
      writeStateModel(input.paths.stateFile, nextState);
      appendRunlogEvent(
        input.paths.runlogFile,
        buildWorkspaceRecoveryCompletedEvent({
          id: input.nextEventId(),
          timestamp: input.timestamp,
          relatedIds: [pending.workspaceId],
          data: { pendingOperationId: pending.id, workspaceId: pending.workspaceId, operationType: "prepare", action: decision.kind },
        }),
      );
      return { report: { ...report, applied: true }, nextState };
    }

    appendRunlogEvent(
      input.paths.runlogFile,
      buildWorkspaceRecoveryBlockedEvent({
        id: input.nextEventId(),
        timestamp: input.timestamp,
        relatedIds: [pending.workspaceId],
        data: { pendingOperationId: pending.id, workspaceId: pending.workspaceId, operationType: "prepare", action: decision.kind },
      }),
    );
    return { report };
  }

  // pending.type === "release"
  const decision = planReleaseRecovery(inspection);
  const report: RecoveryItemReport = {
    pendingOperationId: pending.id,
    workspaceId: pending.workspaceId,
    workUnitId: pending.workUnitId,
    type: "release",
    action: decision.kind,
    reason: decision.kind === "blocked_manual_recovery" ? decision.reason : undefined,
    applied: false,
  };

  if (!input.apply) return { report };

  if (decision.kind === "finalize_release") {
    const finalized = buildReleaseFinalizeCandidate({
      state: input.state,
      pending,
      timestamp: input.timestamp,
      nextEventId: input.nextEventId,
    });
    const nextState: StateModel = {
      ...input.state,
      workspace: {
        managedWorkspaces: finalized.managedWorkspaces,
        workspaceBindings: finalized.workspaceBindings,
        pendingWorkspaceOperations: finalized.pendingWorkspaceOperations,
      },
    };
    writeStateModel(input.paths.stateFile, nextState);
    for (const event of finalized.runlogEvents) appendRunlogEvent(input.paths.runlogFile, event);
    appendRunlogEvent(
      input.paths.runlogFile,
      buildWorkspaceRecoveryCompletedEvent({
        id: input.nextEventId(),
        timestamp: input.timestamp,
        relatedIds: [pending.workspaceId],
        data: { pendingOperationId: pending.id, workspaceId: pending.workspaceId, operationType: "release", action: decision.kind },
      }),
    );
    return { report: { ...report, applied: true }, nextState };
  }

  if (decision.kind === "retry_release_only_with_apply") {
    // The workspace is confirmed present, registered, branch-matched,
    // clean, and conflict-free -- safe to retry the exact same
    // `worktree remove` the interrupted release was attempting.
    try {
      gitWorktreeRemove(input.implementationRoot, pending.expectedWorkspacePath);
    } catch (err) {
      const message = err instanceof GitRunnerError ? err.message : "Git worktree removal failed.";
      const blockedReport: RecoveryItemReport = { ...report, reason: `Retry failed: ${message}` };
      appendRunlogEvent(
        input.paths.runlogFile,
        buildWorkspaceRecoveryBlockedEvent({
          id: input.nextEventId(),
          timestamp: input.timestamp,
          relatedIds: [pending.workspaceId],
          data: { pendingOperationId: pending.id, workspaceId: pending.workspaceId, operationType: "release", action: "blocked_manual_recovery" },
        }),
      );
      return { report: blockedReport };
    }

    const postRetryInspection = inspectIsolatedWorkspace({
      implementationRoot: input.implementationRoot,
      workspacePath: pending.expectedWorkspacePath,
      expectedBranch: expectedBranch,
    });
    if (postRetryInspection.exists || postRetryInspection.registered) {
      // §14.3: still cannot be verified as removed -- preserve the
      // pending operation, do not guess.
      return { report };
    }

    const finalized = buildReleaseFinalizeCandidate({
      state: input.state,
      pending,
      timestamp: input.timestamp,
      nextEventId: input.nextEventId,
    });
    const nextState: StateModel = {
      ...input.state,
      workspace: {
        managedWorkspaces: finalized.managedWorkspaces,
        workspaceBindings: finalized.workspaceBindings,
        pendingWorkspaceOperations: finalized.pendingWorkspaceOperations,
      },
    };
    writeStateModel(input.paths.stateFile, nextState);
    for (const event of finalized.runlogEvents) appendRunlogEvent(input.paths.runlogFile, event);
    appendRunlogEvent(
      input.paths.runlogFile,
      buildWorkspaceRecoveryCompletedEvent({
        id: input.nextEventId(),
        timestamp: input.timestamp,
        relatedIds: [pending.workspaceId],
        data: { pendingOperationId: pending.id, workspaceId: pending.workspaceId, operationType: "release", action: decision.kind },
      }),
    );
    return { report: { ...report, applied: true }, nextState };
  }

  appendRunlogEvent(
    input.paths.runlogFile,
    buildWorkspaceRecoveryBlockedEvent({
      id: input.nextEventId(),
      timestamp: input.timestamp,
      relatedIds: [pending.workspaceId],
      data: { pendingOperationId: pending.id, workspaceId: pending.workspaceId, operationType: "release", action: decision.kind },
    }),
  );
  return { report };
}
