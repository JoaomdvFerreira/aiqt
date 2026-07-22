import type { StateModel } from "../schema/state.schema.js";
import { deriveEffectiveExecutionMetadata } from "./execution-metadata-defaults.js";
import {
  getWorkspaceBindings,
  getManagedWorkspaces,
  getPendingWorkspaceOperations,
  findActiveBindingForWorkUnit,
  findManagedWorkspaceById,
} from "../services/workspace-state-service.js";
import { gitIsInsideWorkTree } from "../workspaces/git-command-runner.js";
import { inspectIsolatedWorkspace } from "../workspaces/workspace-inspection.js";

export interface WorkspaceReadinessSummary {
  prepared: number;
  unprepared: number;
  recoveryRequired: number;
  dirty: number;
  drifted: number;
}

/**
 * M25 §19: bounded physical-readiness facts for `aiqt status --parallel`,
 * scoped to the already-computed effectively-ready Work Unit set (never
 * the whole historical workspace ledger) -- keeps the live Git inspection
 * bounded to the same small population the parallel advisory already
 * reports on. Never mutates state, never changes M24 logical eligibility,
 * never prepares a workspace. `implementationRoot` may be a non-Git
 * directory (or unavailable); in that case dirty/drifted stay at 0 for
 * isolated workspaces rather than guessing.
 */
export function computeWorkspaceReadiness(
  state: StateModel,
  readyWorkUnitIds: readonly string[],
  implementationRoot: string,
): WorkspaceReadinessSummary {
  const bindings = getWorkspaceBindings(state);
  const workspaces = getManagedWorkspaces(state);
  const recoveryRequired = getPendingWorkspaceOperations(state).length;

  let prepared = 0;
  let unprepared = 0;
  let dirty = 0;
  let drifted = 0;

  const gitAvailable = gitIsInsideWorkTree(implementationRoot);

  for (const workUnitId of readyWorkUnitIds) {
    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === workUnitId);
    if (!workUnit) continue;
    const effective = deriveEffectiveExecutionMetadata(workUnit);
    const mode = effective.workspaceAssignment.mode;
    if (mode === "none" || mode === "unknown") continue;

    const binding = findActiveBindingForWorkUnit(workUnitId, bindings);
    const workspace = binding ? findManagedWorkspaceById(binding.workspaceId, workspaces) : undefined;
    if (!binding || !workspace) {
      unprepared += 1;
      continue;
    }
    prepared += 1;

    if (gitAvailable && workspace.providerId === "git-worktree@1" && workspace.branchName) {
      const inspection = inspectIsolatedWorkspace({
        implementationRoot,
        workspacePath: workspace.workspacePath,
        expectedBranch: workspace.branchName,
      });
      if (!inspection.registered || !inspection.branchMatches) {
        drifted += 1;
      } else if (!inspection.clean || inspection.hasUnresolvedConflict) {
        dirty += 1;
      }
    }
  }

  return { prepared, unprepared, recoveryRequired, dirty, drifted };
}
