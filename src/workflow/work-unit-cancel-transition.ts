import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";
import { recalculateMilestoneStatuses } from "./checkpoint-status-transitions.js";

/**
 * Decide whether a cancelled in_progress work unit should revert to "ready"
 * or "planned", based on its current inbound blocking (blocks/requires)
 * dependencies -- the same rule dependency-readiness.ts uses to promote
 * planned work to ready. relates_to is informational and ignored.
 */
export function computeWorkUnitCancelStatus(
  workUnitId: string,
  dependencies: readonly Dependency[],
  workUnits: readonly WorkUnit[],
): WorkUnitStatus {
  const incomingBlocking = dependencies.filter(
    (d) => d.toId === workUnitId && (d.type === "blocks" || d.type === "requires"),
  );
  if (incomingBlocking.length === 0) return "ready";

  const statusById = new Map(workUnits.map((wu) => [wu.id, wu.status]));
  const allSourcesDone = incomingBlocking.every((d) => statusById.get(d.fromId) === "done");
  return allSourcesDone ? "ready" : "planned";
}

export interface WorkUnitCancelTransitionResult {
  workUnits: WorkUnit[];
  milestones: Milestone[];
  restoredStatus: WorkUnitStatus;
}

/**
 * Apply the `aiqt next cancel` mutation (M9 §8.5): revert the cancelled
 * work unit from in_progress to ready/planned and fully recompute milestone
 * statuses from the updated children. Every other work unit is left
 * untouched.
 */
export function applyWorkUnitCancelTransition(
  state: StateModel,
  workUnitId: string,
  timestamp: string,
): WorkUnitCancelTransitionResult {
  const restoredStatus = computeWorkUnitCancelStatus(
    workUnitId,
    state.workGraph.dependencies,
    state.workGraph.workUnits,
  );
  const workUnits = state.workGraph.workUnits.map((wu) =>
    wu.id === workUnitId ? { ...wu, status: restoredStatus, updatedAt: timestamp } : wu,
  );
  const milestones = recalculateMilestoneStatuses(workUnits, state.workGraph.milestones);
  return { workUnits, milestones, restoredStatus };
}
