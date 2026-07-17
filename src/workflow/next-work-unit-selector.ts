import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import { computeEffectiveReadinessForState } from "./effective-readiness.js";

export interface WorkUnitSelection {
  workUnit: WorkUnit | null;
  milestone: Milestone | null;
}

/**
 * M18 §8: select the first *effectively* ready work unit in stored
 * workUnits order. Canonical status "ready" alone is not sufficient -- a
 * work unit can be canonically ready but have an active unsatisfied
 * blocking dependency (stale readiness, e.g. after M17-RC1 append adds a new
 * dependency onto an existing ready unit). Does not reorder work units or
 * infer priority from any other field; `aiqt next` and `aiqt next --preview`
 * both call this so selection is always identical for the same state.
 */
export function selectNextReadyWorkUnit(state: StateModel): WorkUnitSelection {
  const readiness = computeEffectiveReadinessForState(state);
  const workUnit =
    state.workGraph.workUnits.find((wu) => readiness.get(wu.id)?.effectivelyReady === true) ?? null;
  if (!workUnit) {
    return { workUnit: null, milestone: null };
  }
  const milestone =
    state.workGraph.milestones.find((m) => m.id === workUnit.milestoneId) ?? null;
  return { workUnit, milestone };
}
