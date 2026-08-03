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

export interface PointerRepairProposal {
  pointerName: "currentMilestoneId" | "currentWorkUnitId";
  currentValue: string;
  proposedValue: null;
  reason: string;
  wouldMutate: true;
}

export interface GraphRepairPlan {
  wouldMutate: false;
  suggestions: GraphRepairSuggestion[];
  /** M18 §11.1: deterministic ready -> planned proposals for stale-ready work units. */
  staleReadinessRepairs: StaleReadinessRepairProposal[];
  /** M32 §5.6: deterministic dangling current-pointer repairs. */
  pointerRepairs: PointerRepairProposal[];
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
  const pointerRepairs = buildPointerRepairProposals(state);

  return { wouldMutate: false, suggestions, staleReadinessRepairs, pointerRepairs, investigationGuidance };
}

export function buildPointerRepairProposals(state: StateModel): PointerRepairProposal[] {
  const proposals: PointerRepairProposal[] = [];
  const milestoneIds = new Set(state.workGraph.milestones.map((m) => m.id));
  const workUnitIds = new Set(state.workGraph.workUnits.map((wu) => wu.id));

  if (state.currentMilestoneId !== null && !milestoneIds.has(state.currentMilestoneId)) {
    proposals.push({
      pointerName: "currentMilestoneId",
      currentValue: state.currentMilestoneId,
      proposedValue: null,
      reason: `currentMilestoneId "${state.currentMilestoneId}" does not reference an existing milestone; clearing it is deterministic and does not alter work history.`,
      wouldMutate: true,
    });
  }

  if (state.currentWorkUnitId !== null && !workUnitIds.has(state.currentWorkUnitId)) {
    proposals.push({
      pointerName: "currentWorkUnitId",
      currentValue: state.currentWorkUnitId,
      proposedValue: null,
      reason: `currentWorkUnitId "${state.currentWorkUnitId}" does not reference an existing work unit; clearing it is deterministic and does not alter work history.`,
      wouldMutate: true,
    });
  }

  return proposals;
}

export interface StaleReadinessRepairApplyResult {
  state: StateModel;
  repairedWorkUnitIds: string[];
  changes: Array<{ workUnitId: string; from: "ready"; to: "planned" }>;
}

export interface PointerRepairApplyResult {
  state: StateModel;
  repairedPointers: Array<{ pointerName: "currentMilestoneId" | "currentWorkUnitId"; from: string; to: null }>;
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

export function applyPointerRepairs(
  state: StateModel,
  timestamp: string,
): PointerRepairApplyResult {
  const proposals = buildPointerRepairProposals(state);
  const repairedPointers = proposals.map((proposal) => ({
    pointerName: proposal.pointerName,
    from: proposal.currentValue,
    to: null,
  }));

  return {
    state: {
      ...state,
      currentMilestoneId: proposals.some((proposal) => proposal.pointerName === "currentMilestoneId")
        ? null
        : state.currentMilestoneId,
      currentWorkUnitId: proposals.some((proposal) => proposal.pointerName === "currentWorkUnitId")
        ? null
        : state.currentWorkUnitId,
      lastUpdatedAt: proposals.length > 0 ? timestamp : state.lastUpdatedAt,
    },
    repairedPointers,
  };
}
