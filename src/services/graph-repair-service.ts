import type { StateModel } from "../schema/state.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { GraphValidationResult } from "./graph-validation-service.js";
import { findStaleReadyWorkUnits } from "../workflow/effective-readiness.js";
import { recalculateMilestoneStatuses } from "../workflow/checkpoint-status-transitions.js";

export interface GraphRepairSuggestion {
  findingRule: string;
  dependencyId: string;
  recommendedCommand: string;
  confidence: "high" | "medium" | "low";
}

/** M18 §11.1: one deterministic ready -> planned repair candidate. */
export interface StaleReadinessRepairProposal {
  workUnitId: string;
  currentStatus: "ready";
  proposedStatus: "planned";
  unsatisfiedDependencyIds: string[];
  blockingPredecessorWorkUnitIds: string[];
  reason: string;
  wouldMutate: true;
}

export interface GraphRepairPlan {
  wouldMutate: false;
  suggestions: GraphRepairSuggestion[];
  /** M18 §11.1: deterministic ready -> planned proposals for stale-ready work units. */
  staleReadinessRepairs: StaleReadinessRepairProposal[];
  investigationGuidance: string[];
}

/**
 * M18 §6/§11.1: deterministic `ready -> planned` repair proposals for every
 * canonically-ready-but-not-effectively-ready work unit, computed directly
 * from state via the single centralized effective-readiness engine (not
 * re-derived from graph-validate warnings) so dry-run, apply, and the
 * stale-readiness finding can never disagree about which units qualify.
 */
export function buildStaleReadinessRepairProposals(
  state: StateModel,
): StaleReadinessRepairProposal[] {
  return findStaleReadyWorkUnits(state).map((r) => ({
    workUnitId: r.workUnitId,
    currentStatus: "ready" as const,
    proposedStatus: "planned" as const,
    unsatisfiedDependencyIds: r.unsatisfiedDependencyIds,
    blockingPredecessorWorkUnitIds: r.blockingPredecessorWorkUnitIds,
    reason: `Work unit "${r.workUnitId}" is canonically "ready" but has an unsatisfied blocking/requires dependency (blocked by: ${r.blockingPredecessorWorkUnitIds.join(", ")}); normalizing to "planned".`,
    wouldMutate: true as const,
  }));
}

/**
 * M12 §8.4/M18 §11: read-only dry-run repair planning. Warnings with a
 * single, unambiguous, deterministic fix (late-stage-relates-to) become
 * copy-paste-runnable `aiqt dependency update` suggestions; stale-readiness
 * work units get their own deterministic `ready -> planned` proposals
 * (§11.1) since M18 makes that repair fully mechanical, unlike the other
 * warning families which still only get investigation guidance. Never
 * mutates state, files, or runlog.
 */
export function buildGraphRepairPlan(
  validation: GraphValidationResult,
  state: StateModel,
): GraphRepairPlan {
  const suggestions: GraphRepairSuggestion[] = [];
  const investigationGuidance: string[] = [];

  for (const warning of validation.warnings) {
    if (warning.rule === "late-stage-relates-to" && warning.dependencyId) {
      suggestions.push({
        findingRule: warning.rule,
        dependencyId: warning.dependencyId,
        recommendedCommand: `aiqt dependency update ${warning.dependencyId} --type blocks --reason "Late-stage relates_to dependency likely represents an unmodeled blocking prerequisite."`,
        confidence: "medium",
      });
      continue;
    }
    if (warning.rule === "stale-readiness") continue; // handled deterministically below, not as investigation-only guidance.
    investigationGuidance.push(`[${warning.rule}] ${warning.message}`);
  }

  for (const error of validation.blockingErrors) {
    investigationGuidance.push(`[${error.rule}] ${error.message}`);
  }

  const staleReadinessRepairs = buildStaleReadinessRepairProposals(state);

  return { wouldMutate: false, suggestions, staleReadinessRepairs, investigationGuidance };
}

export interface StaleReadinessRepairApplyResult {
  state: StateModel;
  repairedWorkUnitIds: string[];
  changes: Array<{ workUnitId: string; from: "ready"; to: "planned" }>;
}

/**
 * M18 §11.2: build the full candidate state for applying every deterministic
 * stale-readiness repair atomically. Pure and side-effect free -- the caller
 * decides whether to persist. Only the identified stale-ready work units'
 * status changes (ready -> planned); every other work unit, and every
 * terminal/history status (done/replanned/cancelled/in_progress/
 * needs_review), is left completely untouched. Milestone statuses are
 * recomputed from the (possibly changed) children exactly as every other
 * status-mutating engine in this codebase already does.
 */
export function applyStaleReadinessRepair(
  state: StateModel,
  timestamp: string,
): StaleReadinessRepairApplyResult {
  const proposals = buildStaleReadinessRepairProposals(state);
  const repairWorkUnitIds = new Set(proposals.map((p) => p.workUnitId));

  const workUnits: WorkUnit[] = state.workGraph.workUnits.map((wu) =>
    repairWorkUnitIds.has(wu.id) ? { ...wu, status: "planned" as const, updatedAt: timestamp } : wu,
  );
  const milestones: Milestone[] = recalculateMilestoneStatuses(workUnits, state.workGraph.milestones);

  return {
    state: {
      ...state,
      workGraph: { ...state.workGraph, workUnits, milestones },
      lastUpdatedAt: timestamp,
    },
    repairedWorkUnitIds: proposals.map((p) => p.workUnitId),
    changes: proposals.map((p) => ({ workUnitId: p.workUnitId, from: "ready" as const, to: "planned" as const })),
  };
}
