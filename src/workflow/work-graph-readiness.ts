import type { WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { MilestoneStatus } from "../schema/milestone.schema.js";

/**
 * A work unit is ready only if it has no unsatisfied incoming blocking
 * dependency (an incoming `blocks` or `requires` edge). Since M3 always
 * builds a fresh graph with no work done yet, any incoming blocking
 * dependency keeps the target work unit `planned` rather than `ready`.
 */
export function computeWorkUnitStatus(
  hasIncomingBlockingDependency: boolean,
): WorkUnitStatus {
  return hasIncomingBlockingDependency ? "planned" : "ready";
}

/**
 * A milestone is `ready` if at least one child work unit is ready; otherwise
 * `planned`. M3 never creates empty milestones, so every milestone has at
 * least one child work unit in one of these two statuses.
 */
export function computeMilestoneStatus(
  childWorkUnitStatuses: readonly WorkUnitStatus[],
): MilestoneStatus {
  return childWorkUnitStatuses.includes("ready") ? "ready" : "planned";
}
