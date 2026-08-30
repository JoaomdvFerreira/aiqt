import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Dependency, DependencyType } from "../schema/dependency.schema.js";
import { findCycle } from "./dependency-graph.js";
import { computeEffectiveReadinessForWorkUnits } from "./effective-readiness.js";

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

export interface DependencyReadinessRecalculationOptions {
  /**
   * Normal dependency mutations retain their historical behavior: a planned
   * unit with no remaining blockers becomes ready. Graph repair opts out so
   * it repairs only a persisted state that a blocking relationship can have
   * made stale, rather than promoting independent planned work speculatively.
   */
  promoteWithoutBlockingDependencies?: boolean;
}

/**
 * Reconcile persisted readiness through the canonical effective-readiness
 * evaluator. Both dependency updates and graph repair use this primitive so
 * neither path can re-derive blocking or replanned-predecessor semantics.
 * Only `ready` and `planned` work units are touched.
 */
export function recalculateReadinessAfterDependencyUpdate(
  workUnits: readonly WorkUnit[],
  dependencies: readonly Dependency[],
  timestamp: string,
  options: DependencyReadinessRecalculationOptions = {},
): DependencyReadinessRecalculation {
  const effectiveReadiness = computeEffectiveReadinessForWorkUnits(workUnits, dependencies);
  const newlyReadyWorkUnitIds: string[] = [];
  const newlyPlannedWorkUnitIds: string[] = [];

  const updated = workUnits.map((wu) => {
    if (wu.status !== "ready" && wu.status !== "planned") return wu;

    const readiness = effectiveReadiness.get(wu.id)!;
    const desired: WorkUnitStatus = wu.status === "ready"
      ? readiness.unsatisfiedDependencyIds.length > 0 ? "planned" : "ready"
      : ((options.promoteWithoutBlockingDependencies ?? true) || readiness.blockingDependencyIds.length > 0) &&
          readiness.unsatisfiedDependencyIds.length === 0
        ? "ready"
        : "planned";
    if (desired === wu.status) return wu;

    if (desired === "ready") newlyReadyWorkUnitIds.push(wu.id);
    else newlyPlannedWorkUnitIds.push(wu.id);
    return { ...wu, status: desired, updatedAt: timestamp };
  });

  return { workUnits: updated, newlyReadyWorkUnitIds, newlyPlannedWorkUnitIds };
}
