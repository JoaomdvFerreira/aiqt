import type { ProjectStatus } from "../schema/state.schema.js";
import type { WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { StateModel } from "../schema/state.schema.js";

export const WORK_UNIT_STATUSES: readonly WorkUnitStatus[] = [
  "pending",
  "active",
  "blocked",
  "in_review",
  "done",
];

/** Count work units grouped by status, always returning every status key. */
export function workUnitCountsByStatus(
  state: StateModel,
): Record<WorkUnitStatus, number> {
  const counts = {
    pending: 0,
    active: 0,
    blocked: 0,
    in_review: 0,
    done: 0,
  } as Record<WorkUnitStatus, number>;
  for (const unit of state.workGraph.workUnits) {
    counts[unit.status] += 1;
  }
  return counts;
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return ["draft", "planned", "in_progress", "blocked", "done"].includes(value);
}
