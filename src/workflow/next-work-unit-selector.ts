import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
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
 * infer priority from any other field. Used as-is (default mode only) by
 * aiqt checkpoint/checkpoint amend/next cancel's "what would run next"
 * recommendation; aiqt next and aiqt next --preview use the richer
 * resolveNextSelection below instead, which this function's logic is a
 * strict subset of.
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

// ---------------------------------------------------------------------------
// M20: explicit ready work unit and milestone selection.
// ---------------------------------------------------------------------------

export type NextSelectionRequest =
  | { mode: "default" }
  | { mode: "work_unit"; workUnitId: string }
  | { mode: "milestone"; milestoneId: string };

/** A minimal, additive-output-friendly projection of an effectively ready work unit. */
export interface ReadyCandidate {
  workUnitId: string;
  title: string;
  milestoneId: string;
  milestoneTitle: string;
}

export type SelectionBlockingReasonCode =
  | "unknown-work-unit"
  | "unknown-milestone"
  | "not-effectively-ready"
  | "no-ready-candidate-in-scope";

export interface SelectionBlockingReason {
  code: SelectionBlockingReasonCode;
  message: string;
  canonicalStatus?: WorkUnitStatus;
  unsatisfiedDependencyIds?: string[];
  blockingPredecessorWorkUnitIds?: string[];
}

export interface NextSelectionResult {
  mode: NextSelectionRequest["mode"];
  selectedWorkUnit: WorkUnit | null;
  selectedMilestone: Milestone | null;
  /** Every effectively ready work unit in the whole graph, stored order. */
  globalCandidates: ReadyCandidate[];
  /** Effectively ready candidates within the request's own scope (== globalCandidates for "default"; the single requested unit for "work_unit"; milestone members for "milestone"). */
  scopedCandidates: ReadyCandidate[];
  /** Non-null exactly when selectedWorkUnit is null. */
  blockingReason: SelectionBlockingReason | null;
}

function toCandidate(wu: WorkUnit, milestoneById: ReadonlyMap<string, Milestone>): ReadyCandidate {
  return {
    workUnitId: wu.id,
    title: wu.title,
    milestoneId: wu.milestoneId,
    milestoneTitle: milestoneById.get(wu.milestoneId)?.title ?? wu.milestoneId,
  };
}

/**
 * M20 §11: the one authoritative selection engine behind every `aiqt next`
 * mode (default, --work-unit, --milestone) and both preview and apply --
 * identical inputs always produce an identical result, so preview/apply
 * parity is structural, not conventional. Reuses the M18 effective-readiness
 * engine exclusively; never reimplements blocks/requires/relates_to/stale-
 * readiness/replanned satisfaction. The caller (next.command.ts /
 * next-preview.command.ts) is responsible for the active-work-unit guard,
 * which takes precedence over every mode and is checked before this is ever
 * called.
 */
export function resolveNextSelection(
  state: StateModel,
  request: NextSelectionRequest,
): NextSelectionResult {
  const readiness = computeEffectiveReadinessForState(state);
  const milestoneById = new Map(state.workGraph.milestones.map((m) => [m.id, m]));
  const globalCandidates = state.workGraph.workUnits
    .filter((wu) => readiness.get(wu.id)?.effectivelyReady === true)
    .map((wu) => toCandidate(wu, milestoneById));

  if (request.mode === "default") {
    const workUnit =
      state.workGraph.workUnits.find((wu) => readiness.get(wu.id)?.effectivelyReady === true) ?? null;
    return {
      mode: "default",
      selectedWorkUnit: workUnit,
      selectedMilestone: workUnit ? (milestoneById.get(workUnit.milestoneId) ?? null) : null,
      globalCandidates,
      scopedCandidates: globalCandidates,
      blockingReason: workUnit
        ? null
        : { code: "no-ready-candidate-in-scope", message: "No effectively ready work unit exists." },
    };
  }

  if (request.mode === "work_unit") {
    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === request.workUnitId) ?? null;
    if (!workUnit) {
      return {
        mode: "work_unit",
        selectedWorkUnit: null,
        selectedMilestone: null,
        globalCandidates,
        scopedCandidates: [],
        blockingReason: {
          code: "unknown-work-unit",
          message: `Work unit "${request.workUnitId}" does not exist.`,
        },
      };
    }
    const result = readiness.get(workUnit.id);
    if (!result?.effectivelyReady) {
      return {
        mode: "work_unit",
        selectedWorkUnit: null,
        selectedMilestone: null,
        globalCandidates,
        scopedCandidates: [],
        blockingReason: {
          code: "not-effectively-ready",
          message: `Work unit "${workUnit.id}" is not effectively ready (canonical status: ${workUnit.status}).`,
          canonicalStatus: workUnit.status,
          unsatisfiedDependencyIds: result?.unsatisfiedDependencyIds ?? [],
          blockingPredecessorWorkUnitIds: result?.blockingPredecessorWorkUnitIds ?? [],
        },
      };
    }
    const milestone = milestoneById.get(workUnit.milestoneId) ?? null;
    return {
      mode: "work_unit",
      selectedWorkUnit: workUnit,
      selectedMilestone: milestone,
      globalCandidates,
      scopedCandidates: [toCandidate(workUnit, milestoneById)],
      blockingReason: null,
    };
  }

  // request.mode === "milestone"
  const milestone = milestoneById.get(request.milestoneId) ?? null;
  if (!milestone) {
    return {
      mode: "milestone",
      selectedWorkUnit: null,
      selectedMilestone: null,
      globalCandidates,
      scopedCandidates: [],
      blockingReason: {
        code: "unknown-milestone",
        message: `Milestone "${request.milestoneId}" does not exist.`,
      },
    };
  }
  const scopedCandidates = globalCandidates.filter((c) => c.milestoneId === milestone.id);
  const selectedWorkUnit =
    state.workGraph.workUnits.find(
      (wu) => wu.milestoneId === milestone.id && readiness.get(wu.id)?.effectivelyReady === true,
    ) ?? null;
  return {
    mode: "milestone",
    selectedWorkUnit,
    selectedMilestone: selectedWorkUnit ? milestone : null,
    globalCandidates,
    scopedCandidates,
    blockingReason: selectedWorkUnit
      ? null
      : {
          code: "no-ready-candidate-in-scope",
          message: `No effectively ready work unit exists in milestone "${milestone.id}".`,
        },
  };
}
