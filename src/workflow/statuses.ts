import type { ProjectStatus } from "../schema/state.schema.js";
import type { WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { StateModel } from "../schema/state.schema.js";

export const WORK_UNIT_STATUSES: readonly WorkUnitStatus[] = [
  "ready",
  "planned",
  "in_progress",
  "needs_review",
  "done",
  "replanned",
  "cancelled",
];

/** Count work units grouped by status, always returning every status key. */
export function workUnitCountsByStatus(
  state: StateModel,
): Record<WorkUnitStatus, number> {
  const counts = {
    ready: 0,
    planned: 0,
    in_progress: 0,
    needs_review: 0,
    done: 0,
    replanned: 0,
    cancelled: 0,
  } as Record<WorkUnitStatus, number>;
  for (const unit of state.workGraph.workUnits) {
    counts[unit.status] += 1;
  }
  return counts;
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return ["draft", "planned", "in_progress", "blocked", "done"].includes(value);
}
