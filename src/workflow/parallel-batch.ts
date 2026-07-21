import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import { computeEffectiveReadinessForState } from "./effective-readiness.js";
import { resolveNextSelection } from "./next-work-unit-selector.js";
import { deriveEffectiveExecutionMetadata, isActiveOccupancyStatus } from "./execution-metadata-defaults.js";
import { evaluateParallelEligibility, type EligibilityReason } from "./parallel-eligibility.js";
import { ADVISORY_BATCH_WORK_UNITS_MAX } from "../schema/execution-metadata.schema.js";

export interface ExcludedWorkUnit {
  workUnitId: string;
  reasons: EligibilityReason[];
}

export interface ParallelBatchResult {
  primaryWorkUnitId: string | null;
  activeWorkUnitIds: string[];
  selectedWorkUnitIds: string[];
  excluded: ExcludedWorkUnit[];
  manualReviewWorkUnitIds: string[];
  deterministicOrder: string[];
}

/**
 * M24 §10: one deterministic, non-mutating, stable-order greedy advisory
 * batch. Never searches for a maximum independent set, never schedules,
 * never persists, never appends a runlog event, and never uses a
 * timestamp or random ID -- the result depends only on `state`.
 */
export function buildParallelBatch(state: StateModel): ParallelBatchResult {
  const readiness = computeEffectiveReadinessForState(state);
  const workUnitsInGraphOrder = state.workGraph.workUnits;

  // 1-3. Ready candidates, in stable graph order (the stored array order),
  // tie-broken by work unit ID (ids are unique, so this tiebreak is
  // defensive/redundant in practice, but applied literally per §10.2).
  const readyCandidates = workUnitsInGraphOrder
    .filter((wu) => readiness.get(wu.id)?.effectivelyReady === true)
    .sort((a, b) => {
      const indexA = workUnitsInGraphOrder.indexOf(a);
      const indexB = workUnitsInGraphOrder.indexOf(b);
      if (indexA !== indexB) return indexA - indexB;
      return a.id.localeCompare(b.id);
    })
    .slice(0, ADVISORY_BATCH_WORK_UNITS_MAX);

  const activeWorkUnits = workUnitsInGraphOrder.filter((wu) => isActiveOccupancyStatus(wu.status));
  const activeWorkUnitIds = new Set(activeWorkUnits.map((wu) => wu.id));

  // 4. The existing next selector's primary candidate, when one exists
  // among the ready set.
  const nextSelection = resolveNextSelection(state, { mode: "default" });
  const primaryWorkUnit =
    nextSelection.selectedWorkUnit && readyCandidates.some((wu) => wu.id === nextSelection.selectedWorkUnit!.id)
      ? nextSelection.selectedWorkUnit
      : null;

  // Evaluate the primary first (if any), then the remaining ready
  // candidates in their natural stable order.
  const orderedCandidates: WorkUnit[] = primaryWorkUnit
    ? [primaryWorkUnit, ...readyCandidates.filter((wu) => wu.id !== primaryWorkUnit.id)]
    : readyCandidates;

  const context = { dependencies: state.workGraph.dependencies, readiness, activeWorkUnitIds };

  const selected: WorkUnit[] = [];
  const manualReview: string[] = [];
  const excluded: ExcludedWorkUnit[] = [];

  for (const candidate of orderedCandidates) {
    const effective = deriveEffectiveExecutionMetadata(candidate);
    if (effective.parallelPolicy.mode === "manual_review") {
      manualReview.push(candidate.id);
      continue;
    }

    const reasonSet = new Set<EligibilityReason>();

    for (const active of activeWorkUnits) {
      if (active.id === candidate.id) continue;
      const result = evaluateParallelEligibility(candidate, active, context);
      if (!result.eligible) {
        for (const reason of result.reasons) reasonSet.add(reason);
      }
    }

    for (const already of selected) {
      const result = evaluateParallelEligibility(candidate, already, context);
      if (!result.eligible) {
        for (const reason of result.reasons) reasonSet.add(reason);
      }
    }

    if (reasonSet.size === 0) {
      selected.push(candidate);
    } else {
      excluded.push({ workUnitId: candidate.id, reasons: [...reasonSet].sort() });
    }
  }

  return {
    primaryWorkUnitId: primaryWorkUnit?.id ?? null,
    activeWorkUnitIds: [...activeWorkUnitIds].sort(),
    selectedWorkUnitIds: selected.map((wu) => wu.id),
    excluded,
    manualReviewWorkUnitIds: manualReview,
    deterministicOrder: orderedCandidates.map((wu) => wu.id),
  };
}
