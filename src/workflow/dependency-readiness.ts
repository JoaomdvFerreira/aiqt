import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";
import { recalculateReadinessAfterDependencyUpdate } from "./dependency-update-transition.js";

export interface DependencyReadinessResult {
  workUnits: WorkUnit[];
  newlyReadyWorkUnitIds: string[];
}

/**
 * M17 §9.4: a blocking dependency whose source has been replanned (via
 * `aiqt plan --extend`) is treated as satisfied for readiness purposes. The
 * replanned work unit itself can never become "done", so treating it as
 * still-blocking would permanently freeze every downstream dependent; the
 * replacement subgraph's own copied boundary dependency (from its exit work
 * units) is what actually gates downstream readiness now. This was
 * unreachable before M17 -- no prior command ever set status "replanned".
 */
export function isBlockingSourceSatisfied(sourceStatus: WorkUnitStatus): boolean {
  return sourceStatus === "done" || sourceStatus === "replanned";
}

/**
 * Recalculate dependency readiness after a work unit becomes done. Only
 * `blocks`/`requires` dependencies are blocking; `relates_to` is
 * informational and ignored here. A planned work unit becomes ready only
 * when every incoming blocking dependency points to a source work unit with
 * status "done". Only planned -> ready transitions are ever applied; no
 * other status is touched. Newly ready work units are returned in
 * state.workGraph.workUnits stored order.
 */
export function recalculateDependencyReadiness(
  workUnits: readonly WorkUnit[],
  dependencies: readonly Dependency[],
  timestamp: string,
): DependencyReadinessResult {
  const reconciled = recalculateReadinessAfterDependencyUpdate(workUnits, dependencies, timestamp);
  return { workUnits: reconciled.workUnits, newlyReadyWorkUnitIds: reconciled.newlyReadyWorkUnitIds };
}
