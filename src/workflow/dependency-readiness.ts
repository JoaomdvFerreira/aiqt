import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";

export interface DependencyReadinessResult {
  workUnits: WorkUnit[];
  newlyReadyWorkUnitIds: string[];
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
  const statusById = new Map(workUnits.map((wu) => [wu.id, wu.status]));
  const newlyReadyWorkUnitIds: string[] = [];

  const updated = workUnits.map((wu) => {
    if (wu.status !== "planned") return wu;

    const incomingBlocking = dependencies.filter(
      (d) => d.toId === wu.id && (d.type === "blocks" || d.type === "requires"),
    );
    if (incomingBlocking.length === 0) return wu;

    const allSourcesDone = incomingBlocking.every(
      (d) => statusById.get(d.fromId) === "done",
    );
    if (!allSourcesDone) return wu;

    newlyReadyWorkUnitIds.push(wu.id);
    return { ...wu, status: "ready" as const, updatedAt: timestamp };
  });

  return { workUnits: updated, newlyReadyWorkUnitIds };
}
