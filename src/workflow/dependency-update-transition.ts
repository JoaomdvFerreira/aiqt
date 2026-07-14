import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Dependency, DependencyType } from "../schema/dependency.schema.js";
import { findCycle } from "./dependency-graph.js";

/**
 * M12 §8.2/§11: true if changing `dependency` to `newType` would introduce a
 * cycle in the blocking/requires dependency graph. relates_to edges are
 * never blocking and can never introduce a cycle.
 */
export function wouldIntroduceCycle(
  workUnits: readonly WorkUnit[],
  dependencies: readonly Dependency[],
  dependencyId: string,
  newType: DependencyType,
): boolean {
  if (newType === "relates_to") return false;

  const nodes = workUnits.map((wu) => wu.id);
  const edges = dependencies
    .map((d) => (d.id === dependencyId ? { ...d, type: newType } : d))
    .filter((d) => d.type === "blocks" || d.type === "requires")
    .map((d) => ({ from: d.fromId, to: d.toId }));

  return findCycle(nodes, edges) !== null;
}

/**
 * M12 §8.2/§11: true if changing `dependency` to `newType` would retroactively
 * impose a new blocking prerequisite on a work unit that is already
 * in_progress -- i.e. work already underway would no longer have satisfied
 * its (newly modeled) prerequisites. relates_to updates never invalidate
 * active execution.
 */
export function wouldInvalidateActiveExecution(
  workUnits: readonly WorkUnit[],
  dependency: Dependency,
  newType: DependencyType,
): boolean {
  if (newType === "relates_to") return false;

  const target = workUnits.find((wu) => wu.id === dependency.toId);
  if (!target || target.status !== "in_progress") return false;

  const source = workUnits.find((wu) => wu.id === dependency.fromId);
  return source?.status !== "done";
}

export interface DependencyReadinessRecalculation {
  workUnits: WorkUnit[];
  newlyReadyWorkUnitIds: string[];
  newlyPlannedWorkUnitIds: string[];
}

/**
 * M12 §11: bidirectional readiness recalculation for a dependency type
 * change. Unlike `recalculateDependencyReadiness` (M5, one-directional:
 * planned -> ready only, triggered by a work unit becoming done), a
 * dependency update can loosen OR tighten a blocking requirement, so both
 * promotion (planned -> ready) and demotion (ready -> planned) must be
 * considered. Only work units currently "ready" or "planned" are ever
 * touched; done/in_progress/needs_review/cancelled/replanned are left alone.
 */
export function recalculateReadinessAfterDependencyUpdate(
  workUnits: readonly WorkUnit[],
  dependencies: readonly Dependency[],
  timestamp: string,
): DependencyReadinessRecalculation {
  const statusById = new Map(workUnits.map((wu) => [wu.id, wu.status]));
  const newlyReadyWorkUnitIds: string[] = [];
  const newlyPlannedWorkUnitIds: string[] = [];

  const updated = workUnits.map((wu) => {
    if (wu.status !== "ready" && wu.status !== "planned") return wu;

    const incomingBlocking = dependencies.filter(
      (d) => d.toId === wu.id && (d.type === "blocks" || d.type === "requires"),
    );
    const allSourcesDone = incomingBlocking.every(
      (d) => statusById.get(d.fromId) === "done",
    );
    const desired: WorkUnitStatus = allSourcesDone ? "ready" : "planned";
    if (desired === wu.status) return wu;

    if (desired === "ready") newlyReadyWorkUnitIds.push(wu.id);
    else newlyPlannedWorkUnitIds.push(wu.id);
    return { ...wu, status: desired, updatedAt: timestamp };
  });

  return { workUnits: updated, newlyReadyWorkUnitIds, newlyPlannedWorkUnitIds };
}
