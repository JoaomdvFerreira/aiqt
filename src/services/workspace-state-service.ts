import type { StateModel } from "../schema/state.schema.js";
import type { ManagedWorkspace } from "../schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../schema/workspace-binding.schema.js";
import type { PendingWorkspaceOperation } from "../schema/pending-workspace-operation.schema.js";

/** M25 §5: missing state.workspace must be treated as an empty ManagedWorkspace collection. */
export function getManagedWorkspaces(state: StateModel): ManagedWorkspace[] {
  return state.workspace?.managedWorkspaces ?? [];
}

/** M25 §5: missing state.workspace must be treated as an empty WorkspaceBinding collection. */
export function getWorkspaceBindings(state: StateModel): WorkspaceBinding[] {
  return state.workspace?.workspaceBindings ?? [];
}

/** M25 §5: missing state.workspace must be treated as an empty PendingWorkspaceOperation collection. */
export function getPendingWorkspaceOperations(state: StateModel): PendingWorkspaceOperation[] {
  return state.workspace?.pendingWorkspaceOperations ?? [];
}

export function findManagedWorkspaceById(
  workspaceId: string,
  workspaces: readonly ManagedWorkspace[],
): ManagedWorkspace | undefined {
  return workspaces.find((w) => w.id === workspaceId);
}

export function findWorkspacesBySeriesKey(
  workspaceSeriesKey: string,
  workspaces: readonly ManagedWorkspace[],
): ManagedWorkspace[] {
  return workspaces.filter((w) => w.workspaceSeriesKey === workspaceSeriesKey);
}

export function findActiveBindingForWorkUnit(
  workUnitId: string,
  bindings: readonly WorkspaceBinding[],
): WorkspaceBinding | undefined {
  return bindings.find((b) => b.workUnitId === workUnitId && b.status === "active");
}

export function findActiveBindingsForWorkspace(
  workspaceId: string,
  bindings: readonly WorkspaceBinding[],
): WorkspaceBinding[] {
  return bindings.filter((b) => b.workspaceId === workspaceId && b.status === "active");
}

export function findPendingOperationForWorkUnit(
  workUnitId: string,
  pending: readonly PendingWorkspaceOperation[],
): PendingWorkspaceOperation | undefined {
  return pending.find((p) => p.workUnitId === workUnitId);
}

export function findPendingPreparesForSeries(
  workspaceSeriesKey: string,
  pending: readonly PendingWorkspaceOperation[],
): PendingWorkspaceOperation[] {
  return pending.filter((p) => p.type === "prepare" && p.workspaceSeriesKey === workspaceSeriesKey);
}
