import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";

export interface WorkUnitSelection {
  workUnit: WorkUnit | null;
  milestone: Milestone | null;
}

/**
 * Select the first work unit with status "ready" in stored workUnits order.
 * Does not reorder work units or infer priority from any other field.
 */
export function selectNextReadyWorkUnit(state: StateModel): WorkUnitSelection {
  const workUnit = state.workGraph.workUnits.find((wu) => wu.status === "ready") ?? null;
  if (!workUnit) {
    return { workUnit: null, milestone: null };
  }
  const milestone =
    state.workGraph.milestones.find((m) => m.id === workUnit.milestoneId) ?? null;
  return { workUnit, milestone };
}
