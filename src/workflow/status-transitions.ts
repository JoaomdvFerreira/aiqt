import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";

export interface WorkGraphTransitionResult {
  workUnits: WorkUnit[];
  milestones: Milestone[];
}

/**
 * Move the selected work unit from ready to in_progress, and its milestone
 * from ready to in_progress. Every other work unit and milestone is left
 * untouched, including ready sibling work units in the same milestone —
 * milestone status is a derived workflow summary, not a selection gate.
 */
export function applyWorkUnitStartTransition(
  state: StateModel,
  workUnitId: string,
  milestoneId: string,
  timestamp: string,
): WorkGraphTransitionResult {
  const workUnits = state.workGraph.workUnits.map((wu) =>
    wu.id === workUnitId
      ? { ...wu, status: "in_progress" as const, updatedAt: timestamp }
      : wu,
  );
  const milestones = state.workGraph.milestones.map((m) =>
    m.id === milestoneId ? { ...m, status: "in_progress" as const } : m,
  );
  return { workUnits, milestones };
}
