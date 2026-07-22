import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { WorkspaceProviderId, ManagedWorkspaceMode } from "../schema/managed-workspace.schema.js";
import { deriveEffectiveExecutionMetadata } from "./execution-metadata-defaults.js";
import {
  getManagedWorkspaces,
  getWorkspaceBindings,
  findActiveBindingForWorkUnit,
  findManagedWorkspaceById,
} from "../services/workspace-state-service.js";

export interface ManagedWorkspaceAdvisory {
  /** False when the effective M24 mode is "none" or unresolved -- no repository workspace applies at all. */
  applicable: boolean;
  workspacePrepared: boolean;
  providerId?: WorkspaceProviderId;
  workspaceMode?: ManagedWorkspaceMode;
  workspacePath?: string;
  branchName?: string;
  baseCommit?: string;
  /**
   * M25 §18: canonical-only status -- the packet never executes Git, so
   * this reflects only the persisted lifecycleStatus, never live
   * cleanliness/drift. Use `aiqt workspace status --work-unit <id>` for a
   * live read.
   */
  inspectionStatus?: string;
}

/**
 * M25 §18: builds the bounded, read-only facts for the current Work
 * Unit's handoff packet. Reuses `deriveEffectiveExecutionMetadata` (M24)
 * for mode resolution and the WU25-01 workspace-state-service finders --
 * never re-derives mode or re-implements the binding lookup. Never
 * executes Git; never mutates `state`.
 */
export function buildManagedWorkspaceAdvisory(workUnit: WorkUnit, state: StateModel): ManagedWorkspaceAdvisory {
  const effective = deriveEffectiveExecutionMetadata(workUnit);
  const mode = effective.workspaceAssignment.mode;
  if (mode === "none" || mode === "unknown") {
    return { applicable: false, workspacePrepared: false };
  }

  const binding = findActiveBindingForWorkUnit(workUnit.id, getWorkspaceBindings(state));
  if (!binding) {
    return { applicable: true, workspacePrepared: false };
  }
  const workspace = findManagedWorkspaceById(binding.workspaceId, getManagedWorkspaces(state));
  if (!workspace) {
    return { applicable: true, workspacePrepared: false };
  }

  return {
    applicable: true,
    workspacePrepared: true,
    providerId: workspace.providerId,
    workspaceMode: workspace.mode,
    workspacePath: workspace.workspacePath,
    branchName: workspace.branchName,
    baseCommit: workspace.baseCommit,
    inspectionStatus: workspace.lifecycleStatus === "ready" ? "ready_canonical_not_git_verified" : "released",
  };
}

/**
 * M25 §18: renders the "Managed Workspace" packet section. Never claims
 * an agent was started, never executes Git, never includes a provider
 * command, and never exposes an unrelated workspace.
 */
export function renderManagedWorkspaceSection(advisory: ManagedWorkspaceAdvisory): string {
  const lines: string[] = [];
  lines.push("## Managed Workspace");
  lines.push("");

  if (!advisory.applicable) {
    lines.push("No repository workspace is required for this work unit (workspace mode: none).");
    return lines.join("\n");
  }

  if (!advisory.workspacePrepared) {
    lines.push("workspacePrepared: false");
    lines.push(
      "This work unit's managed workspace has not been prepared. Run `aiqt workspace prepare <work-unit-id>` before making changes.",
    );
    return lines.join("\n");
  }

  lines.push("workspacePrepared: true");
  lines.push(`- Provider: ${advisory.providerId}`);
  lines.push(`- Workspace mode: ${advisory.workspaceMode}`);
  lines.push(`- Workspace path: ${advisory.workspacePath}`);
  if (advisory.branchName !== undefined) {
    lines.push(`- Branch: ${advisory.branchName}`);
  }
  lines.push(`- Base commit: ${advisory.baseCommit}`);
  lines.push(`- Inspection status: ${advisory.inspectionStatus}`);
  lines.push(
    "This packet identifies the local workspace to use -- it does not start the work unit, execute Git, or start an agent.",
  );
  return lines.join("\n");
}
