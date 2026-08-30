import type { StateModel } from "../schema/state.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { GraphValidationResult } from "./graph-validation-service.js";
import { computeEffectiveReadinessForState } from "../workflow/effective-readiness.js";
import { recalculateReadinessAfterDependencyUpdate } from "../workflow/dependency-update-transition.js";
import { recalculateMilestoneStatuses } from "../workflow/checkpoint-status-transitions.js";

export interface GraphRepairSuggestion {
  findingRule: string;
  dependencyId: string;
  recommendedCommand: string;
  confidence: "high" | "medium" | "low";
}

/** One deterministic persisted-readiness reconciliation candidate. */
export interface StaleReadinessRepairProposal {
  workUnitId: string;
  currentStatus: "ready" | "planned";
  proposedStatus: "ready" | "planned";
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
 * Deterministic persisted-readiness reconciliation proposals, computed from
 * the single centralized effective-readiness engine. A persisted `ready`
 * with unmet blockers is demoted; a persisted `planned` with every blocker
 * satisfied is promoted. Terminal and active statuses are never touched.
 */
export function buildStaleReadinessRepairProposals(
  state: StateModel,
): StaleReadinessRepairProposal[] {
  return [...computeEffectiveReadinessForState(state).values()].flatMap<StaleReadinessRepairProposal>((r) => {
    if (r.canonicalStatus === "ready" && r.unsatisfiedDependencyIds.length > 0) {
      return [{
        workUnitId: r.workUnitId,
        currentStatus: "ready" as const,
        proposedStatus: "planned" as const,
        unsatisfiedDependencyIds: r.unsatisfiedDependencyIds,
        blockingPredecessorWorkUnitIds: r.blockingPredecessorWorkUnitIds,
        reason: `Work unit "${r.workUnitId}" is canonically "ready" but has an unsatisfied blocking/requires dependency (blocked by: ${r.blockingPredecessorWorkUnitIds.join(", ")}); normalizing to "planned".`,
        wouldMutate: true as const,
      }];
    }
    if (
      r.canonicalStatus === "planned" &&
      r.blockingDependencyIds.length > 0 &&
      r.unsatisfiedDependencyIds.length === 0
    ) {
      return [{
        workUnitId: r.workUnitId,
        currentStatus: "planned" as const,
        proposedStatus: "ready" as const,
        unsatisfiedDependencyIds: r.unsatisfiedDependencyIds,
        blockingPredecessorWorkUnitIds: r.blockingPredecessorWorkUnitIds,
        reason: `Work unit "${r.workUnitId}" is canonically "planned" but every blocking/requires dependency is satisfied; normalizing to "ready".`,
        wouldMutate: true as const,
      }];
    }
    return [];
  });
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
  changes: Array<{ workUnitId: string; from: "ready" | "planned"; to: "ready" | "planned" }>;
}

export interface PointerRepairApplyResult {
  state: StateModel;
  repairedPointers: Array<{ pointerName: "currentMilestoneId" | "currentWorkUnitId"; from: string; to: null }>;
}

/**
 * M18 §11.2: build the full candidate state for applying every deterministic
 * readiness reconciliation atomically. Pure and side-effect free -- the
 * caller decides whether to persist. The shared dependency transition
 * primitive is the authority for the actual status changes.
 */
export function applyStaleReadinessRepair(
  state: StateModel,
  timestamp: string,
): StaleReadinessRepairApplyResult {
  const reconciled = recalculateReadinessAfterDependencyUpdate(
    state.workGraph.workUnits,
    state.workGraph.dependencies,
    timestamp,
    { promoteWithoutBlockingDependencies: false },
  );
  const workUnits = reconciled.workUnits;
  const milestones: Milestone[] = recalculateMilestoneStatuses(workUnits, state.workGraph.milestones);
  const changes = state.workGraph.workUnits.flatMap((wu) => {
    const updated = workUnits.find((candidate) => candidate.id === wu.id)!;
    return wu.status === updated.status
      ? []
      : [{ workUnitId: wu.id, from: wu.status as "ready" | "planned", to: updated.status as "ready" | "planned" }];
  });

  return {
    state: {
      ...state,
      workGraph: { ...state.workGraph, workUnits, milestones },
      lastUpdatedAt: timestamp,
    },
    repairedWorkUnitIds: changes.map((change) => change.workUnitId),
    changes,
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
