import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";
import type { EffectiveReadinessResult } from "./effective-readiness.js";
import { deriveEffectiveExecutionMetadata, isActiveOccupancyStatus } from "./execution-metadata-defaults.js";
import { evaluateDependencyRelation } from "./dependency-graph.js";
import { anyResourceClaimsConflict } from "./resource-claim.js";
import {
  ELIGIBILITY_REASONS_PER_PAIR_MAX,
  CONFLICTS_PER_PAIR_MAX,
  resourceClaimIdentity,
} from "../schema/execution-metadata.schema.js";

export type EligibilityDisposition = "eligible" | "serialized" | "manual_review" | "conflict" | "invalid_metadata";

export type EligibilityReason =
  | "metadata_missing"
  | "parallel_policy_serialized"
  | "parallel_policy_manual_review"
  | "work_unit_not_ready"
  | "active_work_unit_conflict"
  | "direct_dependency"
  | "transitive_dependency"
  | "workspace_assignment_conflict"
  | "isolated_assignment_key_reused"
  | "concurrency_group_conflict"
  | "resource_claim_conflict"
  | "invalid_execution_metadata";

export interface ParallelEligibilityResult {
  leftWorkUnitId: string;
  rightWorkUnitId: string;
  eligible: boolean;
  disposition: EligibilityDisposition;
  reasons: EligibilityReason[];
  conflicts: string[];
}

export interface EligibilityEvaluationContext {
  dependencies: readonly Dependency[];
  readiness: ReadonlyMap<string, EffectiveReadinessResult>;
  activeWorkUnitIds: ReadonlySet<string>;
}

/**
 * M24 §9.3: fixed disposition-derivation precedence, applied once every
 * reason has been accumulated (never used to short-circuit evaluation
 * itself -- every check below always runs, so "multiple reasons" and
 * deterministic accumulation both hold). A hard structural conflict
 * (dependency/active/workspace/group/resource) is reported as "conflict"
 * even when the pair's own policy is manual_review/serialized, since that
 * is more actionable than the policy label alone.
 */
function deriveDisposition(reasons: ReadonlySet<EligibilityReason>): EligibilityDisposition {
  if (reasons.has("invalid_execution_metadata")) return "invalid_metadata";
  const structuralConflictReasons: EligibilityReason[] = [
    "work_unit_not_ready",
    "active_work_unit_conflict",
    "direct_dependency",
    "transitive_dependency",
    "workspace_assignment_conflict",
    "isolated_assignment_key_reused",
    "concurrency_group_conflict",
    "resource_claim_conflict",
  ];
  if (structuralConflictReasons.some((r) => reasons.has(r))) return "conflict";
  if (reasons.has("parallel_policy_manual_review")) return "manual_review";
  if (reasons.has("parallel_policy_serialized") || reasons.has("metadata_missing")) return "serialized";
  return "eligible";
}

/**
 * M24 §9: the pure pairwise parallel-eligibility evaluator. Called both
 * for two ready candidates and for a ready candidate against an active
 * (in_progress/needs_review) work unit -- `context.activeWorkUnitIds`
 * covers both usages without a second evaluator. Performs no filesystem,
 * Git, network, or state mutation; every check always runs (no
 * short-circuiting) so accumulated `reasons` can genuinely contain more
 * than one entry for a single pair.
 */
export function evaluateParallelEligibility(
  left: WorkUnit,
  right: WorkUnit,
  context: EligibilityEvaluationContext,
): ParallelEligibilityResult {
  const reasons = new Set<EligibilityReason>();
  const conflicts = new Set<string>();

  const effectiveLeft = deriveEffectiveExecutionMetadata(left);
  const effectiveRight = deriveEffectiveExecutionMetadata(right);

  // 1. Intrinsic metadata validity.
  if (effectiveLeft.metadataStatus === "invalid" || effectiveRight.metadataStatus === "invalid") {
    reasons.add("invalid_execution_metadata");
  }
  if (effectiveLeft.metadataStatus === "missing" || effectiveRight.metadataStatus === "missing") {
    reasons.add("metadata_missing");
  }

  // 2. Candidate/active status.
  const leftIsActive = isActiveOccupancyStatus(left.status);
  const rightIsActive = isActiveOccupancyStatus(right.status);
  const leftIsUsable = context.readiness.get(left.id)?.effectivelyReady === true || leftIsActive;
  const rightIsUsable = context.readiness.get(right.id)?.effectivelyReady === true || rightIsActive;
  if (!leftIsUsable || !rightIsUsable) {
    reasons.add("work_unit_not_ready");
  }
  const involvesActiveWorkUnit = leftIsActive || rightIsActive || context.activeWorkUnitIds.has(left.id) || context.activeWorkUnitIds.has(right.id);

  // 3. Direct/transitive dependency.
  const dependencyRelation = evaluateDependencyRelation(left.id, right.id, context.dependencies);
  if (dependencyRelation.direct) {
    reasons.add("direct_dependency");
    for (const id of dependencyRelation.relatedDependencyIds) conflicts.add(`dependency:${id}`);
  } else if (dependencyRelation.transitive) {
    reasons.add("transitive_dependency");
    conflicts.add(`transitive_dependency:${[left.id, right.id].sort().join("-")}`);
  }

  // 4. Parallel policy.
  if (effectiveLeft.parallelPolicy.mode === "serialized" || effectiveRight.parallelPolicy.mode === "serialized") {
    reasons.add("parallel_policy_serialized");
  }
  if (
    effectiveLeft.parallelPolicy.mode === "manual_review" ||
    effectiveRight.parallelPolicy.mode === "manual_review"
  ) {
    reasons.add("parallel_policy_manual_review");
  }

  // 5. Workspace assignment (M24 §4.4).
  const leftWorkspace = effectiveLeft.workspaceAssignment;
  const rightWorkspace = effectiveRight.workspaceAssignment;
  if (leftWorkspace.mode === "unknown" || rightWorkspace.mode === "unknown") {
    reasons.add("workspace_assignment_conflict");
  } else if (
    leftWorkspace.mode === "isolated" &&
    rightWorkspace.mode === "isolated" &&
    leftWorkspace.assignmentKey !== undefined &&
    leftWorkspace.assignmentKey === rightWorkspace.assignmentKey
  ) {
    reasons.add("isolated_assignment_key_reused");
    conflicts.add(`workspace_assignment:${leftWorkspace.assignmentKey}`);
  } else if (
    leftWorkspace.mode !== "none" &&
    rightWorkspace.mode !== "none" &&
    leftWorkspace.assignmentKey !== undefined &&
    leftWorkspace.assignmentKey === rightWorkspace.assignmentKey &&
    (leftWorkspace.access === "read_write" || rightWorkspace.access === "read_write")
  ) {
    reasons.add("workspace_assignment_conflict");
    conflicts.add(`workspace_assignment:${leftWorkspace.assignmentKey}`);
  }

  // 6. Concurrency group.
  const leftGroup = effectiveLeft.parallelPolicy.concurrencyGroup;
  const rightGroup = effectiveRight.parallelPolicy.concurrencyGroup;
  if (leftGroup !== undefined && rightGroup !== undefined && leftGroup === rightGroup) {
    reasons.add("concurrency_group_conflict");
    conflicts.add(`concurrency_group:${leftGroup}`);
  }

  // 7. Resource claims.
  const leftClaims = effectiveLeft.parallelPolicy.resourceClaims;
  const rightClaims = effectiveRight.parallelPolicy.resourceClaims;
  if (anyResourceClaimsConflict(leftClaims, rightClaims)) {
    reasons.add("resource_claim_conflict");
    for (const claim of leftClaims) {
      conflicts.add(`resource_claim:${resourceClaimIdentity(claim)}`);
    }
    for (const claim of rightClaims) {
      conflicts.add(`resource_claim:${resourceClaimIdentity(claim)}`);
    }
  }

  // "active_work_unit_conflict" labels a structural conflict as involving
  // currently active work, on top of (not instead of) the specific reason.
  const structuralConflictPresent = [
    "direct_dependency",
    "transitive_dependency",
    "workspace_assignment_conflict",
    "isolated_assignment_key_reused",
    "concurrency_group_conflict",
    "resource_claim_conflict",
  ].some((r) => reasons.has(r as EligibilityReason));
  if (involvesActiveWorkUnit && structuralConflictPresent) {
    reasons.add("active_work_unit_conflict");
  }

  // 8. Sort/dedupe (Set already dedupes; sort for determinism), bounded.
  const sortedReasons = [...reasons].sort().slice(0, ELIGIBILITY_REASONS_PER_PAIR_MAX);
  const sortedConflicts = [...conflicts].sort().slice(0, CONFLICTS_PER_PAIR_MAX);

  // 9. Derive disposition.
  const disposition = deriveDisposition(reasons);

  return {
    leftWorkUnitId: left.id,
    rightWorkUnitId: right.id,
    eligible: disposition === "eligible" && sortedReasons.length === 0 && sortedConflicts.length === 0,
    disposition,
    reasons: sortedReasons,
    conflicts: sortedConflicts,
  };
}
