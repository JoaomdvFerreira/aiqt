import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Milestone, MilestoneStatus } from "../schema/milestone.schema.js";
import type { ProjectStatus } from "../schema/state.schema.js";
import type { FinalWorkUnitStatus } from "../schema/checkpoint.schema.js";

/** Move the selected work unit from in_progress to its checkpointed final status. */
export function applyCheckpointWorkUnitTransition(
  workUnits: readonly WorkUnit[],
  workUnitId: string,
  finalStatus: FinalWorkUnitStatus,
  timestamp: string,
): WorkUnit[] {
  return workUnits.map((wu) =>
    wu.id === workUnitId ? { ...wu, status: finalStatus, updatedAt: timestamp } : wu,
  );
}

/**
 * Derive a milestone's status from its children's current statuses. This is
 * a full recomputation (not a delta), so it is safe to apply to every
 * milestone after each checkpoint: milestones whose children are unchanged
 * simply re-derive the same status.
 */
export function computeMilestoneStatus(
  childStatuses: readonly WorkUnitStatus[],
): MilestoneStatus {
  if (childStatuses.some((s) => s === "in_progress" || s === "needs_review")) {
    return "in_progress";
  }
  if (childStatuses.length > 0 && childStatuses.every((s) => s === "done")) {
    return "done";
  }
  if (childStatuses.some((s) => s === "ready")) {
    return "ready";
  }
  return "planned";
}

export function recalculateMilestoneStatuses(
  workUnits: readonly WorkUnit[],
  milestones: readonly Milestone[],
): Milestone[] {
  return milestones.map((m) => {
    const childStatuses = workUnits
      .filter((wu) => wu.milestoneId === m.id)
      .map((wu) => wu.status);
    const status = computeMilestoneStatus(childStatuses);
    return status === m.status ? m : { ...m, status };
  });
}

/**
 * Project status becomes "review" only when the just-checkpointed work unit
 * needs review, or every work unit in the graph is done; otherwise it stays
 * "in_progress" while ready or planned work remains.
 */
export function computeProjectStatus(
  workUnits: readonly WorkUnit[],
  checkpointedFinalStatus: FinalWorkUnitStatus,
): ProjectStatus {
  if (checkpointedFinalStatus === "needs_review") return "review";
  if (workUnits.every((wu) => wu.status === "done")) return "review";
  return "in_progress";
}
