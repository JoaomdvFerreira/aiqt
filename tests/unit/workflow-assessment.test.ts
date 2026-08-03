import { describe, expect, it } from "vitest";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import {
  WORKFLOW_RECOMMENDATION_RULES,
  assessWorkflow,
  deriveAssessmentProjectStatus,
} from "../../src/workflow/workflow-assessment.js";

const NOW = "2026-01-01T00:00:00.000Z";

function baseProject(overrides: Partial<ProjectModel> = {}): ProjectModel {
  return {
    version: "1.0.0",
    project: {
      id: "PROJECT-001",
      name: "Test",
      objective: "",
      targetUsers: [],
      preferredAgent: null,
      existingRepositoryPath: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    context: {
      constraints: [],
      nonGoals: [],
      technologyPreferences: [],
      businessRules: [],
      architectureNotes: [],
    },
    requirements: [],
    decisions: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    quality: {
      acceptanceCriteriaRequired: true,
      validationRequiredBeforeDone: true,
      preferredValidationCommands: [],
    },
    ...overrides,
  };
}

function readyProject(overrides: Partial<ProjectModel> = {}): ProjectModel {
  const base = baseProject();
  return {
    ...base,
    project: {
      ...base.project,
      objective: "Ship the product",
      targetUsers: ["operators"],
    },
    context: {
      ...base.context,
      architectureNotes: ["Local canonical files drive workflow state."],
    },
    ...overrides,
  };
}

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "draft",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: { milestones: [], workUnits: [], dependencies: [] },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: NOW,
    ...overrides,
  };
}

function workUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "Build",
    objective: "Build it",
    scope: ["Implementation"],
    outOfScope: [],
    acceptanceCriteria: ["Works"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "M001",
    title: "Milestone",
    objective: "Complete it",
    status: "ready",
    workUnitIds: ["WU001"],
    ...overrides,
  };
}

function dependency(overrides: Partial<Dependency> = {}): Dependency {
  return {
    id: "DEP001",
    fromId: "WU001",
    toId: "WU002",
    type: "blocks",
    reason: "Dependency",
    ...overrides,
  };
}

function stateWithGraph(
  workUnits: WorkUnit[],
  overrides: Partial<StateModel> = {},
  dependencies: Dependency[] = [],
): StateModel {
  const milestones = new Map<string, Milestone>();
  for (const wu of workUnits) {
    const existing = milestones.get(wu.milestoneId);
    milestones.set(
      wu.milestoneId,
      existing
        ? { ...existing, workUnitIds: [...existing.workUnitIds, wu.id] }
        : milestone({
            id: wu.milestoneId,
            status: wu.status === "done" ? "done" : wu.status === "in_progress" || wu.status === "needs_review" ? "in_progress" : "ready",
            workUnitIds: [wu.id],
          }),
    );
  }
  return baseState({
    projectStatus: "planned",
    workGraph: { milestones: [...milestones.values()], workUnits, dependencies },
    ...overrides,
  });
}

describe("assessWorkflow contract", () => {
  it("exposes the complete WU32-01 assessment contract", () => {
    const assessment = assessWorkflow(baseProject(), baseState());

    expect(assessment).toMatchObject({
      integrityStatus: "valid",
      findings: [],
      workflowPosition: "incomplete_context",
      projectStatus: "draft",
      currentMilestoneId: null,
      currentWorkUnitId: null,
      developmentComplete: false,
      productionReady: null,
      recommendedCommand: "aiqt update",
      recommendationRuleId: "incomplete-context",
      canMutate: true,
      planningContext: {
        ready: false,
        missingConditions: ["objective", "target_user", "implementation_context"],
      },
    });
    expect(typeof assessment.recommendationReason).toBe("string");
    expect(assessment.recommendationReason.length).toBeGreaterThan(0);
  });

  it("defines the required recommendation precedence table in priority order", () => {
    expect(WORKFLOW_RECOMMENDATION_RULES.map((r) => r.id)).toEqual([
      "invalid-state",
      "active-in-progress",
      "needs-review",
      "incomplete-context",
      "planning-ready-no-graph",
      "ready-work",
      "stale-ready-work",
      "all-development-work-complete",
      "development-complete-production-not-ready",
      "terminal-export-reporting",
      "no-actionable-command",
    ]);
    expect(WORKFLOW_RECOMMENDATION_RULES.map((r) => r.priority)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("invalid dangling references beat active, ready, and terminal signals", () => {
    const state = stateWithGraph([workUnit({ status: "in_progress" })], {
      currentWorkUnitId: "WU999",
    });

    const assessment = assessWorkflow(readyProject(), state);

    expect(assessment.integrityStatus).toBe("invalid");
    expect(assessment.recommendationRuleId).toBe("invalid-state");
    expect(assessment.workflowPosition).toBe("invalid_state");
    expect(assessment.recommendedCommand).toBe("aiqt graph validate");
    expect(assessment.canMutate).toBe(false);
    expect(assessment.findings.map((f) => f.id)).toContain("WORKFLOW-CURRENT-WORK-UNIT-DANGLING");
  });

  it("active in-progress beats needs_review and ready work", () => {
    const state = stateWithGraph(
      [
        workUnit({ id: "WU001", status: "in_progress" }),
        workUnit({ id: "WU002", status: "needs_review" }),
        workUnit({ id: "WU003", status: "ready" }),
      ],
      { currentWorkUnitId: "WU001" },
    );

    expect(assessWorkflow(readyProject(), state)).toMatchObject({
      recommendationRuleId: "active-in-progress",
      recommendedCommand: "aiqt checkpoint",
      workflowPosition: "active_in_progress",
    });
  });

  it("needs_review beats ready work", () => {
    const state = stateWithGraph([
      workUnit({ id: "WU001", status: "needs_review" }),
      workUnit({ id: "WU002", status: "ready" }),
    ]);

    expect(assessWorkflow(readyProject(), state)).toMatchObject({
      recommendationRuleId: "needs-review",
      recommendedCommand: "aiqt checkpoint amend",
    });
  });

  it("distinguishes incomplete context from planning-ready/no-graph", () => {
    expect(assessWorkflow(baseProject(), baseState())).toMatchObject({
      recommendationRuleId: "incomplete-context",
      recommendedCommand: "aiqt update",
      planningContext: { ready: false },
    });

    expect(assessWorkflow(readyProject(), baseState())).toMatchObject({
      recommendationRuleId: "planning-ready-no-graph",
      recommendedCommand: "aiqt plan",
      planningContext: { ready: true, missingConditions: [] },
    });
  });

  it("uses effective readiness so ready beats terminal and stale ready does not masquerade as actionable ready work", () => {
    const blocked = workUnit({ id: "WU001", status: "planned" });
    const staleReady = workUnit({ id: "WU002", status: "ready", dependencies: ["DEP001"] });
    const dep = dependency({ fromId: "WU001", toId: "WU002" });

    expect(assessWorkflow(readyProject(), stateWithGraph([blocked, staleReady], {}, [dep]))).toMatchObject({
      recommendationRuleId: "stale-ready-work",
      workflowPosition: "stale_ready_work",
      recommendedCommand: "aiqt graph repair --apply",
    });

    expect(
      assessWorkflow(
        readyProject(),
        stateWithGraph([blocked, staleReady, workUnit({ id: "WU003", status: "ready" })], {}, [dep]),
      ),
    ).toMatchObject({
      recommendationRuleId: "ready-work",
      recommendedCommand: "aiqt next",
    });
  });

  it("separates development complete, production not ready, and terminal export states", () => {
    const doneState = stateWithGraph([workUnit({ status: "done" })]);

    expect(assessWorkflow(readyProject(), doneState)).toMatchObject({
      recommendationRuleId: "all-development-work-complete",
      productionReady: null,
      recommendedCommand: "aiqt review --mode release",
    });
    expect(assessWorkflow(readyProject(), doneState, { productionReady: false })).toMatchObject({
      recommendationRuleId: "development-complete-production-not-ready",
      recommendedCommand: "aiqt manage",
    });
    expect(assessWorkflow(readyProject(), doneState, { productionReady: true })).toMatchObject({
      recommendationRuleId: "terminal-export-reporting",
      projectStatus: "done",
      recommendedCommand: "aiqt export all",
    });
  });

  it("exports the intended project-status owner derivation", () => {
    expect(deriveAssessmentProjectStatus(baseState(), "incomplete_context")).toBe("draft");
    expect(deriveAssessmentProjectStatus(stateWithGraph([workUnit({ status: "in_progress" })]), "active_in_progress")).toBe("in_progress");
    expect(deriveAssessmentProjectStatus(stateWithGraph([workUnit({ status: "done" })]), "development_complete")).toBe("review");
    expect(deriveAssessmentProjectStatus(stateWithGraph([workUnit({ status: "done" })]), "terminal_export_reporting")).toBe("done");
  });

  it("is read-only and does not materialize runlog or canonical state side effects", () => {
    const state = stateWithGraph([workUnit({ status: "ready" })]);
    const before = JSON.stringify(state);

    const assessment = assessWorkflow(readyProject(), state);

    expect(assessment.recommendationRuleId).toBe("ready-work");
    expect(JSON.stringify(state)).toBe(before);
    expect(assessment.findings).toEqual([]);
  });
});
