import type { StateModel } from "../schema/state.schema.js";
import type { ManagedWorkspace, ManagedWorkspaceAccess } from "../schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../schema/workspace-binding.schema.js";
import type { PendingWorkspaceOperation } from "../schema/pending-workspace-operation.schema.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";
import {
  getManagedWorkspaces,
  getWorkspaceBindings,
  getPendingWorkspaceOperations,
  findWorkspacesBySeriesKey,
  findActiveBindingForWorkUnit,
  findPendingOperationForWorkUnit,
  findPendingPreparesForSeries,
} from "../services/workspace-state-service.js";
import {
  deriveWorkspaceSeriesKey,
  deriveWorkspaceInstanceIdentity,
  derivePendingOperationId,
  resolveGenerationForSeries,
} from "./workspace-identity.js";
import { deriveWorkspacePath } from "./workspace-path-policy.js";
import { deriveBranchName } from "./workspace-branch-policy.js";
import { nextId } from "../state/ids.js";
import {
  buildWorkspacePreparedEvent,
  buildWorkspaceBindingCreatedEvent,
} from "../state/runlog-store.js";

const ISOLATED_PROVIDER_ID = "git-worktree@1" as const;

export interface GitWorktreePlanParams {
  state: StateModel;
  projectId: string;
  workUnitId: string;
  assignmentKey: string;
  access: ManagedWorkspaceAccess;
  implementationRoot: string;
  workspaceRoot: string;
  headCommit: string;
}

export type GitWorktreePlanAction =
  | { kind: "no_op"; workspace: ManagedWorkspace; binding: WorkspaceBinding }
  | { kind: "recover_pending"; pending: PendingWorkspaceOperation }
  | {
      kind: "prepare_new";
      workspaceId: string;
      workspaceSeriesKey: string;
      generation: number;
      workspacePath: string;
      branchName: string;
    };

export interface GitWorktreePlanFailure {
  ok: false;
  error: string;
}

export type GitWorktreePlanResult = { ok: true; action: GitWorktreePlanAction } | GitWorktreePlanFailure;

/**
 * M25 §10.3/§14.1 step 1-4: the pure planning step -- resolves the
 * logical series, decides whether this is a true no-op (an active
 * binding/workspace instance already matches exactly), whether an
 * existing pending prepare must be recovered instead of started fresh,
 * or whether a brand-new generation must be allocated -- without
 * performing any I/O. The caller (workspace-service.ts, WU25-06) is
 * responsible for the operation lock, the actual Git side effect, and
 * persistence.
 */
export function planGitWorktreePrepare(params: GitWorktreePlanParams): GitWorktreePlanResult {
  const existingWorkspaces = getManagedWorkspaces(params.state);
  const existingBindings = getWorkspaceBindings(params.state);
  const existingPending = getPendingWorkspaceOperations(params.state);

  const existingBindingForWorkUnit = findActiveBindingForWorkUnit(params.workUnitId, existingBindings);
  if (existingBindingForWorkUnit) {
    const workspace = existingWorkspaces.find((w) => w.id === existingBindingForWorkUnit.workspaceId);
    if (workspace && workspace.providerId === ISOLATED_PROVIDER_ID) {
      return { ok: true, action: { kind: "no_op", workspace, binding: existingBindingForWorkUnit } };
    }
    return {
      ok: false,
      error: `Work unit ${params.workUnitId} already has an active workspace binding to a different workspace.`,
    };
  }

  const existingPendingForWorkUnit = findPendingOperationForWorkUnit(params.workUnitId, existingPending);
  if (existingPendingForWorkUnit && existingPendingForWorkUnit.type === "prepare") {
    return { ok: true, action: { kind: "recover_pending", pending: existingPendingForWorkUnit } };
  }

  const seriesKey = deriveWorkspaceSeriesKey({
    mode: "isolated",
    projectId: params.projectId,
    providerId: ISOLATED_PROVIDER_ID,
    assignmentKey: params.assignmentKey,
    baseCommit: params.headCommit,
  });

  const seriesWorkspaces = findWorkspacesBySeriesKey(seriesKey, existingWorkspaces);
  const seriesPendingPrepares = findPendingPreparesForSeries(seriesKey, existingPending);

  const generationResolution = resolveGenerationForSeries(
    seriesWorkspaces.map((w) => ({ id: w.id, generation: w.generation, lifecycleStatus: w.lifecycleStatus })),
    seriesPendingPrepares.map((p) => ({ id: p.id, generation: p.generation })),
  );

  if (generationResolution.action === "reuse_pending_generation") {
    const pending = existingPending.find((p) => p.id === generationResolution.existingPendingOperationId);
    if (pending) return { ok: true, action: { kind: "recover_pending", pending } };
  }

  const generation = generationResolution.generation;
  const instanceIdentity = deriveWorkspaceInstanceIdentity(seriesKey, generation);
  const workspaceId = nextId("WS", existingWorkspaces.map((w) => w.id));
  const workspacePath = deriveWorkspacePath(params.workspaceRoot, workspaceId);
  const branchName = deriveBranchName(params.projectId, params.workUnitId, instanceIdentity);

  return {
    ok: true,
    action: { kind: "prepare_new", workspaceId, workspaceSeriesKey: seriesKey, generation, workspacePath, branchName },
  };
}

export interface BuildPendingPrepareParams {
  workUnitId: string;
  workspaceId: string;
  workspaceSeriesKey: string;
  generation: number;
  workspacePath: string;
  branchName: string;
  baseCommit: string;
  timestamp: string;
}

/** M25 §14.1 step 4-5: the deterministic pending-prepare record, persisted BEFORE any Git side effect. */
export function buildPendingPrepareOperation(params: BuildPendingPrepareParams): PendingWorkspaceOperation {
  return {
    id: derivePendingOperationId({
      type: "prepare",
      workUnitId: params.workUnitId,
      workspaceSeriesKey: params.workspaceSeriesKey,
      generation: params.generation,
    }),
    type: "prepare",
    workUnitId: params.workUnitId,
    workspaceId: params.workspaceId,
    workspaceSeriesKey: params.workspaceSeriesKey,
    generation: params.generation,
    providerId: ISOLATED_PROVIDER_ID,
    expectedWorkspacePath: params.workspacePath,
    expectedBranchName: params.branchName,
    baseCommit: params.baseCommit,
    createdAt: params.timestamp,
  };
}

export interface FinalizePrepareParams {
  state: StateModel;
  pending: PendingWorkspaceOperation;
  assignmentKey: string;
  access: ManagedWorkspaceAccess;
  implementationRoot: string;
  timestamp: string;
  nextEventId: () => string;
}

export interface FinalizePrepareResult {
  managedWorkspaces: ManagedWorkspace[];
  workspaceBindings: WorkspaceBinding[];
  pendingWorkspaceOperations: PendingWorkspaceOperation[];
  runlogEvents: RunlogEvent[];
  workspace: ManagedWorkspace;
  binding: WorkspaceBinding;
}

/**
 * M25 §14.1 steps 8-9: builds the final candidate state after the Git
 * side effect has been performed AND independently verified by the
 * caller (workspace-service.ts) -- this function itself performs no
 * verification and no I/O; it only assembles the immutable records and
 * removes the now-completed pending operation.
 */
export function buildPrepareFinalizeCandidate(params: FinalizePrepareParams): FinalizePrepareResult {
  const existingWorkspaces = getManagedWorkspaces(params.state);
  const existingBindings = getWorkspaceBindings(params.state);
  const existingPending = getPendingWorkspaceOperations(params.state);

  const workspace: ManagedWorkspace = {
    id: params.pending.workspaceId,
    workspaceSeriesKey: params.pending.workspaceSeriesKey,
    generation: params.pending.generation,
    providerId: ISOLATED_PROVIDER_ID,
    assignmentKey: params.assignmentKey,
    mode: "isolated",
    access: params.access,
    implementationRoot: params.implementationRoot,
    workspacePath: params.pending.expectedWorkspacePath,
    branchName: params.pending.expectedBranchName,
    baseCommit: params.pending.baseCommit,
    lifecycleStatus: "ready",
    createdAt: params.timestamp,
  };
  const binding: WorkspaceBinding = {
    id: nextId("WSB", existingBindings.map((b) => b.id)),
    workUnitId: params.pending.workUnitId,
    workspaceId: workspace.id,
    status: "active",
    boundAt: params.timestamp,
  };

  const runlogEvents: RunlogEvent[] = [
    buildWorkspacePreparedEvent({
      id: params.nextEventId(),
      timestamp: params.timestamp,
      relatedIds: [workspace.id],
      data: {
        workspaceId: workspace.id,
        providerId: workspace.providerId,
        workspaceSeriesKey: workspace.workspaceSeriesKey,
        generation: workspace.generation,
        lifecycleStatus: "ready",
        outcome: "created",
      },
    }),
    buildWorkspaceBindingCreatedEvent({
      id: params.nextEventId(),
      timestamp: params.timestamp,
      relatedIds: [workspace.id, params.pending.workUnitId],
      data: { workspaceId: workspace.id, workUnitId: params.pending.workUnitId, providerId: workspace.providerId },
    }),
  ];

  return {
    managedWorkspaces: [...existingWorkspaces, workspace],
    workspaceBindings: [...existingBindings, binding],
    pendingWorkspaceOperations: existingPending.filter((p) => p.id !== params.pending.id),
    runlogEvents,
    workspace,
    binding,
  };
}
