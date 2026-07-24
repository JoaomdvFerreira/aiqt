import type { StateModel } from "../schema/state.schema.js";
import type { ExecutionWorkspaceRef } from "../schema/execution-session.schema.js";
import { deriveEffectiveExecutionMetadata } from "./execution-metadata-defaults.js";
import { findActiveBindingForWorkUnit, findManagedWorkspaceById } from "../services/workspace-state-service.js";

export type ResolveWorkspaceRefResult = { ok: true; ref: ExecutionWorkspaceRef } | { ok: false; error: string };

/**
 * M26 §3.2/M27 §3.2: resolves the current Work Unit's execution workspace
 * reference for session-open validation. Shared by M26's `execution
 * import` and M27's Claude Code adapter `request`/`import` commands --
 * never reimplemented per caller.
 */
export function resolveWorkspaceRef(state: StateModel, workUnitId: string | null): ResolveWorkspaceRefResult {
  if (workUnitId === null) {
    return { ok: false, error: "No current work unit." };
  }
  const workUnit = state.workGraph.workUnits.find((wu) => wu.id === workUnitId);
  if (!workUnit) {
    return { ok: false, error: `Work unit ${workUnitId} does not exist.` };
  }
  const effective = deriveEffectiveExecutionMetadata(workUnit);
  const mode = effective.workspaceAssignment.mode;
  if (mode === "none") {
    return { ok: true, ref: { mode: "none" } };
  }
  if (mode === "unknown") {
    return { ok: false, error: "Work unit has no resolved workspace-assignment mode (M24 execution metadata missing or invalid)." };
  }
  const binding = findActiveBindingForWorkUnit(workUnitId, state.workspace?.workspaceBindings ?? []);
  if (!binding) {
    return { ok: false, error: `No active managed workspace binding for work unit ${workUnitId}.` };
  }
  const workspace = findManagedWorkspaceById(binding.workspaceId, state.workspace?.managedWorkspaces ?? []);
  if (!workspace || workspace.lifecycleStatus !== "ready") {
    return { ok: false, error: `Managed workspace for work unit ${workUnitId} is not ready.` };
  }
  return {
    ok: true,
    ref: { mode: "managed", workspaceId: workspace.id, workspaceBindingId: binding.id, workspaceGeneration: workspace.generation },
  };
}
