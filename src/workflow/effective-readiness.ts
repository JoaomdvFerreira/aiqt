import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";

export type EffectiveReadinessReason =
  | "canonical-status-not-ready"
  | "unsatisfied-blocking-dependency";

export interface EffectiveReadinessResult {
  workUnitId: string;
  canonicalStatus: WorkUnitStatus;
  effectivelyReady: boolean;
  unsatisfiedDependencyIds: string[];
  blockingPredecessorWorkUnitIds: string[];
  reasons: EffectiveReadinessReason[];
}

/**
 * M18 §7.3/§8: a `replanned` predecessor only satisfies a blocking
 * dependency into `targetWorkUnitId` when its replacement metadata is
 * structurally sound (non-empty, no self-reference, no duplicates, every id
 * exists) AND the target itself has a genuine boundary dependency from one
 * of those valid replacement work units -- the same defect
 * `collectReplannedInvariantFindings` (review-rules.ts) reports. Duplicating
 * the check here (rather than importing it) is intentional: that collector
 * builds full ReviewFindingCandidate records for every replanned unit
 * unconditionally, while this is a narrow boolean asked once per dependency
 * edge during readiness evaluation. `status === "replanned"` alone must
 * never be treated as satisfying.
 */
function isReplannedPredecessorSatisfying(
  source: WorkUnit,
  targetWorkUnitId: string,
  workUnitIds: ReadonlySet<string>,
  dependencies: readonly Dependency[],
): boolean {
  const replacementIds = source.replacedByWorkUnitIds ?? [];
  if (replacementIds.length === 0) return false;
  if (replacementIds.includes(source.id)) return false;
  if (new Set(replacementIds).size !== replacementIds.length) return false;
  if (!replacementIds.every((id) => workUnitIds.has(id))) return false;

  const validReplacementIds = new Set(replacementIds);
  return dependencies.some(
    (d) =>
      d.toId === targetWorkUnitId &&
      (d.type === "blocks" || d.type === "requires") &&
      validReplacementIds.has(d.fromId),
  );
}

function isSourceSatisfying(
  source: WorkUnit | undefined,
  targetWorkUnitId: string,
  workUnitIds: ReadonlySet<string>,
  dependencies: readonly Dependency[],
): boolean {
  if (!source) return false;
  if (source.status === "done") return true;
  if (source.status === "replanned") {
    return isReplannedPredecessorSatisfying(source, targetWorkUnitId, workUnitIds, dependencies);
  }
  return false;
}

/**
 * M18 §6: the one authoritative effective-readiness calculation for a
 * single work unit. Canonical "ready" is necessary but not sufficient --
 * M17-RC1 append deliberately never changes an existing work unit's status
 * even when a newly added dependency makes it no longer satisfied (append's
 * own required invariant), so a stale canonical "ready" value can persist
 * after a later append. Every selection/diagnostic surface (next, preview,
 * status, graph validate, review, repair) must call this instead of trusting
 * canonicalStatus alone. `relates_to` dependencies are never inspected here
 * -- only `blocks`/`requires` affect readiness.
 */
export function computeEffectiveReadiness(
  workUnit: WorkUnit,
  workUnitById: ReadonlyMap<string, WorkUnit>,
  dependencies: readonly Dependency[],
): EffectiveReadinessResult {
  const workUnitIds = new Set(workUnitById.keys());
  const incomingBlocking = dependencies.filter(
    (d) => d.toId === workUnit.id && (d.type === "blocks" || d.type === "requires"),
  );

  const unsatisfied = incomingBlocking.filter(
    (d) => !isSourceSatisfying(workUnitById.get(d.fromId), workUnit.id, workUnitIds, dependencies),
  );

  const reasons: EffectiveReadinessReason[] = [];
  if (workUnit.status !== "ready") reasons.push("canonical-status-not-ready");
  if (unsatisfied.length > 0) reasons.push("unsatisfied-blocking-dependency");

  return {
    workUnitId: workUnit.id,
    canonicalStatus: workUnit.status,
    effectivelyReady: workUnit.status === "ready" && unsatisfied.length === 0,
    unsatisfiedDependencyIds: unsatisfied.map((d) => d.id),
    blockingPredecessorWorkUnitIds: [...new Set(unsatisfied.map((d) => d.fromId))],
    reasons,
  };
}

/** Effective readiness for every work unit in `state`, keyed by work unit id. */
export function computeEffectiveReadinessForState(
  state: StateModel,
): Map<string, EffectiveReadinessResult> {
  const workUnitById = new Map(state.workGraph.workUnits.map((wu) => [wu.id, wu]));
  return new Map(
    state.workGraph.workUnits.map((wu) => [
      wu.id,
      computeEffectiveReadiness(wu, workUnitById, state.workGraph.dependencies),
    ]),
  );
}

/**
 * M18 §5.3: work units that are canonically "ready" but not effectively
 * ready -- the deterministic repair target (`ready -> planned`).
 */
export function findStaleReadyWorkUnits(state: StateModel): EffectiveReadinessResult[] {
  return [...computeEffectiveReadinessForState(state).values()].filter(
    (r) => r.canonicalStatus === "ready" && !r.effectivelyReady,
  );
}
