import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";
import { computeEffectiveReadinessForWorkUnits } from "./effective-readiness.js";

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
  const effectiveReadiness = computeEffectiveReadinessForWorkUnits(workUnits, dependencies);
  const newlyReadyWorkUnitIds: string[] = [];

  const updated = workUnits.map((wu) => {
    if (wu.status !== "planned") return wu;

    const readiness = effectiveReadiness.get(wu.id)!;
    if (
      readiness.blockingDependencyIds.length === 0 ||
      readiness.unsatisfiedDependencyIds.length > 0
    ) return wu;

    newlyReadyWorkUnitIds.push(wu.id);
    return { ...wu, status: "ready" as const, updatedAt: timestamp };
  });

  return { workUnits: updated, newlyReadyWorkUnitIds };
}
