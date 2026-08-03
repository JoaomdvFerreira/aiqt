import type { Issue } from "../core/output/issue.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { ProjectStatus, StateModel } from "../schema/state.schema.js";
import { computeEffectiveReadinessForState, findStaleReadyWorkUnits } from "./effective-readiness.js";
import { isPlanningContextReady } from "./planning-readiness.js";

export type WorkflowIntegrityStatus = "valid" | "warning" | "invalid";

export type WorkflowPosition =
  | "invalid_state"
  | "active_in_progress"
  | "needs_review"
  | "incomplete_context"
  | "planning_ready_no_graph"
  | "ready_work"
  | "stale_ready_work"
  | "development_complete"
  | "development_complete_production_not_ready"
  | "terminal_export_reporting"
  | "no_actionable_command";

export type WorkflowRecommendationRuleId =
  | "invalid-state"
  | "active-in-progress"
  | "needs-review"
  | "incomplete-context"
  | "planning-ready-no-graph"
  | "ready-work"
  | "stale-ready-work"
  | "all-development-work-complete"
  | "development-complete-production-not-ready"
  | "terminal-export-reporting"
  | "no-actionable-command";

export type PlanningReadinessMissingCondition =
  | "objective"
  | "target_user"
  | "implementation_context"
  | "blocking_open_question";

export interface WorkflowRecommendationRule {
  id: WorkflowRecommendationRuleId;
  priority: number;
  workflowPosition: WorkflowPosition;
  recommendedCommand: string | null;
  canMutate: boolean;
  reason: string;
}

export interface PlanningContextAssessment {
  ready: boolean;
  missingConditions: PlanningReadinessMissingCondition[];
}

export interface WorkflowAssessment {
  integrityStatus: WorkflowIntegrityStatus;
  findings: Issue[];
  workflowPosition: WorkflowPosition;
  projectStatus: ProjectStatus;
  currentMilestoneId: string | null;
  currentWorkUnitId: string | null;
  developmentComplete: boolean;
  productionReady: boolean | null;
  recommendedCommand: string | null;
  recommendationReason: string;
  recommendationRuleId: WorkflowRecommendationRuleId;
  canMutate: boolean;
  planningContext: PlanningContextAssessment;
}

export interface WorkflowAssessmentOptions {
  /**
   * Release-readiness is still owned by manage/review classification in WU32-01.
   * Callers that have already run that classifier may pass the result here; null
   * means production readiness is intentionally unknown.
   */
  productionReady?: boolean | null;
}

export const PLANNING_READINESS_CONDITION_LABELS: Record<PlanningReadinessMissingCondition, string> = {
  objective: "project objective",
  target_user: "target user",
  implementation_context: "implementation-shaping context",
  blocking_open_question: "resolution for blocking open questions",
};

export function formatPlanningReadinessMissingConditions(
  missingConditions: readonly PlanningReadinessMissingCondition[],
): string {
  return missingConditions.map((condition) => PLANNING_READINESS_CONDITION_LABELS[condition]).join(", ");
}

export const WORKFLOW_RECOMMENDATION_RULES: readonly WorkflowRecommendationRule[] = [
  {
    id: "invalid-state",
    priority: 1,
    workflowPosition: "invalid_state",
    recommendedCommand: "aiqt graph validate",
    canMutate: false,
    reason: "Canonical workflow references are broken; inspect graph integrity before mutating state.",
  },
  {
    id: "active-in-progress",
    priority: 2,
    workflowPosition: "active_in_progress",
    recommendedCommand: "aiqt checkpoint",
    canMutate: true,
    reason: "A current work unit is in progress and must be checkpointed before new work starts.",
  },
  {
    id: "needs-review",
    priority: 3,
    workflowPosition: "needs_review",
    recommendedCommand: "aiqt checkpoint amend",
    canMutate: true,
    reason: "At least one work unit needs review resolution before workflow handoff continues.",
  },
  {
    id: "incomplete-context",
    priority: 4,
    workflowPosition: "incomplete_context",
    recommendedCommand: "aiqt update",
    canMutate: true,
    reason: "Planning context is incomplete; update project context before planning.",
  },
  {
    id: "planning-ready-no-graph",
    priority: 5,
    workflowPosition: "planning_ready_no_graph",
    recommendedCommand: "aiqt plan",
    canMutate: true,
    reason: "Planning context is ready and no work graph exists yet.",
  },
  {
    id: "ready-work",
    priority: 6,
    workflowPosition: "ready_work",
    recommendedCommand: "aiqt next",
    canMutate: true,
    reason: "At least one work unit is effectively ready for handoff.",
  },
  {
    id: "stale-ready-work",
    priority: 7,
    workflowPosition: "stale_ready_work",
    recommendedCommand: "aiqt graph repair --apply",
    canMutate: true,
    reason: "Ready work exists only as stale canonical readiness; normalize it before continuing.",
  },
  {
    id: "all-development-work-complete",
    priority: 8,
    workflowPosition: "development_complete",
    recommendedCommand: "aiqt review --mode release",
    canMutate: false,
    reason: "All development work is complete; release readiness still needs authoritative review.",
  },
  {
    id: "development-complete-production-not-ready",
    priority: 9,
    workflowPosition: "development_complete_production_not_ready",
    recommendedCommand: "aiqt manage",
    canMutate: false,
    reason: "Development is complete but production readiness still has release blockers or gaps.",
  },
  {
    id: "terminal-export-reporting",
    priority: 10,
    workflowPosition: "terminal_export_reporting",
    recommendedCommand: "aiqt export all",
    canMutate: false,
    reason: "Development and production readiness are complete; export/reporting is available.",
  },
  {
    id: "no-actionable-command",
    priority: 11,
    workflowPosition: "no_actionable_command",
    recommendedCommand: null,
    canMutate: false,
    reason: "No actionable workflow command can be determined from the current state.",
  },
];

function rule(id: WorkflowRecommendationRuleId): WorkflowRecommendationRule {
  const match = WORKFLOW_RECOMMENDATION_RULES.find((r) => r.id === id);
  if (!match) throw new Error(`Unknown workflow recommendation rule: ${id}`);
  return match;
}

export function assessPlanningContext(project: ProjectModel): PlanningContextAssessment {
  const missingConditions: PlanningReadinessMissingCondition[] = [];

  if (project.project.objective.trim().length === 0) missingConditions.push("objective");
  if (project.project.targetUsers.length === 0) missingConditions.push("target_user");

  const hasRequirement = project.requirements.some((r) => r.status === "accepted" || r.status === "draft");
  const hasImplementationContext =
    hasRequirement ||
    project.context.constraints.length > 0 ||
    project.context.technologyPreferences.length > 0 ||
    project.context.businessRules.length > 0 ||
    project.context.architectureNotes.length > 0;
  if (!hasImplementationContext) missingConditions.push("implementation_context");

  if (project.openQuestions.some((q) => q.status === "open" && q.impact === "blocking")) {
    missingConditions.push("blocking_open_question");
  }

  return {
    ready: isPlanningContextReady(project),
    missingConditions,
  };
}

function collectIntegrityFindings(state: StateModel): Issue[] {
  const findings: Issue[] = [];
  const milestoneIds = new Set(state.workGraph.milestones.map((m) => m.id));
  const workUnitIds = new Set(state.workGraph.workUnits.map((wu) => wu.id));

  if (state.currentMilestoneId !== null && !milestoneIds.has(state.currentMilestoneId)) {
    findings.push({
      id: "WORKFLOW-CURRENT-MILESTONE-DANGLING",
      severity: "critical",
      area: "workflow-integrity",
      message: `currentMilestoneId "${state.currentMilestoneId}" does not reference an existing milestone.`,
      affectedItems: [state.currentMilestoneId],
      suggestedAction: "Run aiqt graph validate before mutating workflow state.",
      agentCanFix: false,
    });
  }

  if (state.currentWorkUnitId !== null && !workUnitIds.has(state.currentWorkUnitId)) {
    findings.push({
      id: "WORKFLOW-CURRENT-WORK-UNIT-DANGLING",
      severity: "critical",
      area: "workflow-integrity",
      message: `currentWorkUnitId "${state.currentWorkUnitId}" does not reference an existing work unit.`,
      affectedItems: [state.currentWorkUnitId],
      suggestedAction: "Run aiqt graph validate before mutating workflow state.",
      agentCanFix: false,
    });
  }

  for (const workUnit of state.workGraph.workUnits) {
    if (!milestoneIds.has(workUnit.milestoneId)) {
      findings.push({
        id: `WORKFLOW-WORK-UNIT-MILESTONE-DANGLING-${workUnit.id}`,
        severity: "critical",
        area: "workflow-integrity",
        message: `Work unit "${workUnit.id}" references missing milestone "${workUnit.milestoneId}".`,
        affectedItems: [workUnit.id, workUnit.milestoneId],
        suggestedAction: "Run aiqt graph validate before mutating workflow state.",
        agentCanFix: false,
      });
    }
    for (const dependencyId of workUnit.dependencies) {
      if (!state.workGraph.dependencies.some((dep) => dep.id === dependencyId)) {
        findings.push({
          id: `WORKFLOW-WORK-UNIT-DEPENDENCY-DANGLING-${workUnit.id}-${dependencyId}`,
          severity: "critical",
          area: "workflow-integrity",
          message: `Work unit "${workUnit.id}" references missing dependency "${dependencyId}".`,
          affectedItems: [workUnit.id, dependencyId],
          suggestedAction: "Run aiqt graph validate before mutating workflow state.",
          agentCanFix: false,
        });
      }
    }
  }

  for (const milestone of state.workGraph.milestones) {
    for (const workUnitId of milestone.workUnitIds) {
      if (!workUnitIds.has(workUnitId)) {
        findings.push({
          id: `WORKFLOW-MILESTONE-WORK-UNIT-DANGLING-${milestone.id}-${workUnitId}`,
          severity: "critical",
          area: "workflow-integrity",
          message: `Milestone "${milestone.id}" references missing work unit "${workUnitId}".`,
          affectedItems: [milestone.id, workUnitId],
          suggestedAction: "Run aiqt graph validate before mutating workflow state.",
          agentCanFix: false,
        });
      }
    }
  }

  for (const dependency of state.workGraph.dependencies) {
    if (!workUnitIds.has(dependency.fromId) || !workUnitIds.has(dependency.toId)) {
      findings.push({
        id: `WORKFLOW-DEPENDENCY-ENDPOINT-DANGLING-${dependency.id}`,
        severity: "critical",
        area: "workflow-integrity",
        message: `Dependency "${dependency.id}" references a missing work unit endpoint.`,
        affectedItems: [dependency.id, dependency.fromId, dependency.toId],
        suggestedAction: "Run aiqt graph validate before mutating workflow state.",
        agentCanFix: false,
      });
    }
  }

  return findings;
}

export function deriveAssessmentProjectStatus(
  state: StateModel,
  workflowPosition: WorkflowPosition,
): ProjectStatus {
  if (workflowPosition === "terminal_export_reporting") return "done";
  if (
    workflowPosition === "development_complete" ||
    workflowPosition === "development_complete_production_not_ready" ||
    workflowPosition === "needs_review"
  ) {
    return "review";
  }
  if (workflowPosition === "active_in_progress") return "in_progress";
  if (state.workGraph.workUnits.length > 0) {
    return state.workGraph.workUnits.some((wu) =>
      wu.status === "done" || wu.status === "replanned" || wu.status === "cancelled",
    )
      ? "in_progress"
      : "planned";
  }
  return "draft";
}

function buildAssessment(
  state: StateModel,
  planningContext: PlanningContextAssessment,
  findings: Issue[],
  developmentComplete: boolean,
  productionReady: boolean | null,
  selectedRule: WorkflowRecommendationRule,
  overrides: Partial<Pick<WorkflowAssessment, "recommendedCommand" | "recommendationReason" | "canMutate">> = {},
): WorkflowAssessment {
  return {
    integrityStatus: findings.some((f) => f.severity === "critical" || f.severity === "high") ? "invalid" : "valid",
    findings,
    workflowPosition: selectedRule.workflowPosition,
    projectStatus: deriveAssessmentProjectStatus(state, selectedRule.workflowPosition),
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    developmentComplete,
    productionReady,
    recommendedCommand: overrides.recommendedCommand ?? selectedRule.recommendedCommand,
    recommendationReason: overrides.recommendationReason ?? selectedRule.reason,
    recommendationRuleId: selectedRule.id,
    canMutate: overrides.canMutate ?? selectedRule.canMutate,
    planningContext,
  };
}

function allFindingsAreSafelyRepairablePointers(findings: readonly Issue[]): boolean {
  return (
    findings.length > 0 &&
    findings.every(
      (finding) =>
        finding.id === "WORKFLOW-CURRENT-WORK-UNIT-DANGLING" ||
        finding.id === "WORKFLOW-CURRENT-MILESTONE-DANGLING",
    )
  );
}

function latestNeedsReviewCheckpointCommand(state: StateModel): string | null {
  for (let i = state.checkpoints.length - 1; i >= 0; i -= 1) {
    const checkpoint = state.checkpoints[i];
    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === checkpoint.workUnitId);
    if (workUnit?.status === "needs_review") {
      return `aiqt checkpoint amend --checkpoint ${checkpoint.id}`;
    }
  }
  return null;
}

export function assessWorkflow(
  project: ProjectModel,
  state: StateModel,
  options: WorkflowAssessmentOptions = {},
): WorkflowAssessment {
  const planningContext = assessPlanningContext(project);
  const integrityFindings = collectIntegrityFindings(state);
  const workUnits = state.workGraph.workUnits;
  const developmentComplete = workUnits.length > 0 && workUnits.every((wu) => wu.status === "done");
  const productionReady = options.productionReady ?? null;

  if (integrityFindings.length > 0) {
    const pointerOnlyRepair = allFindingsAreSafelyRepairablePointers(integrityFindings);
    return buildAssessment(state, planningContext, integrityFindings, developmentComplete, productionReady, rule("invalid-state"), {
      recommendedCommand: pointerOnlyRepair ? "aiqt graph repair --apply" : undefined,
      recommendationReason: pointerOnlyRepair
        ? "Workflow current pointers reference missing graph items; apply the deterministic graph repair before mutating workflow state."
        : undefined,
    });
  }

  const currentWorkUnit = state.currentWorkUnitId
    ? (workUnits.find((wu) => wu.id === state.currentWorkUnitId) ?? null)
    : null;
  if (currentWorkUnit?.status === "in_progress") {
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("active-in-progress"));
  }

  if (workUnits.some((wu) => wu.status === "needs_review")) {
    const command = latestNeedsReviewCheckpointCommand(state);
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("needs-review"), {
      recommendedCommand: command ?? "aiqt review",
      recommendationReason: command
        ? "A work unit needs review resolution; amend the latest needs_review checkpoint before workflow handoff continues."
        : "A work unit needs review resolution, but no amendable checkpoint context was found; run review to inspect the missing recovery context.",
    });
  }

  const hasGraph = state.workGraph.milestones.length > 0;
  if (!planningContext.ready && !hasGraph) {
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("incomplete-context"));
  }

  if (planningContext.ready && !hasGraph) {
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("planning-ready-no-graph"));
  }

  const readiness = computeEffectiveReadinessForState(state);
  if ([...readiness.values()].some((r) => r.effectivelyReady) && state.currentWorkUnitId === null) {
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("ready-work"));
  }

  if (findStaleReadyWorkUnits(state).length > 0) {
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("stale-ready-work"));
  }

  if (developmentComplete && productionReady === true) {
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("terminal-export-reporting"));
  }

  if (developmentComplete && productionReady === false) {
    return buildAssessment(
      state,
      planningContext,
      [],
      developmentComplete,
      productionReady,
      rule("development-complete-production-not-ready"),
    );
  }

  if (developmentComplete) {
    return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("all-development-work-complete"));
  }

  return buildAssessment(state, planningContext, [], developmentComplete, productionReady, rule("no-actionable-command"));
}
