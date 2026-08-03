import { describe, expect, it } from "vitest";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import { buildManageReport } from "../../src/services/manage-service.js";
import type { ReviewResult } from "../../src/services/review-service.js";
import { applyWorkflowAssessmentToState } from "../../src/services/workflow-assessment-persistence.js";
import { computeGuidance } from "../../src/workflow/guidance-rules.js";
import { computeNextAction } from "../../src/workflow/next-action.js";
import { computeReviewNextCommand } from "../../src/workflow/review-next-command.js";
import { assessWorkflow } from "../../src/workflow/workflow-assessment.js";

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

function readyProject(): ProjectModel {
  const project = baseProject();
  return {
    ...project,
    project: {
      ...project.project,
      objective: "Ship workflow",
      targetUsers: ["maintainers"],
    },
    context: {
      ...project.context,
      constraints: ["The CLI owns local canonical state."],
    },
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

function emptyReview(nextRecommendedCommand: string): ReviewResult {
  return {
    findings: [],
    findingCount: 0,
    blockingFindingCount: 0,
    warningFindingCount: 0,
    infoFindingCount: 0,
    recommendedExportTargets: [],
    nextRecommendedCommand,
  };
}

function recommendations(project: ProjectModel, state: StateModel): Record<string, string | null> {
  const allDone =
    state.workGraph.workUnits.length > 0 &&
    state.workGraph.workUnits.every((wu) => wu.status === "done");
  const productionReady = allDone ? true : null;
  const assessment = assessWorkflow(project, state, { productionReady });
  const reviewNext = computeReviewNextCommand(project, state, []);
  const assessedState = applyWorkflowAssessmentToState(project, state, { productionReady });
  return {
    assessment: assessment.recommendedCommand,
    status: productionReady === null
      ? computeNextAction(project, state).nextRecommendedCommand
      : assessWorkflow(project, state, { productionReady }).recommendedCommand,
    startContinue: computeGuidance({ project, state, checkpointInputExists: false, productionReady }).recommendedCommand,
    review: reviewNext,
    manage: buildManageReport(project, state, emptyReview(reviewNext)).recommendedCommand,
    mutationPersistence: assessedState.nextRecommendedCommand,
  };
}

describe("WU32-05 workflow recommendation parity", () => {
  it("aligns all-done owners on terminal export", () => {
    const state = stateWithGraph([workUnit({ status: "done" })], {
      projectStatus: "review",
      nextRecommendedCommand: "aiqt review",
    });

    expect(recommendations(readyProject(), state)).toEqual({
      assessment: "aiqt export all",
      status: "aiqt export all",
      startContinue: "aiqt export all",
      review: "aiqt export all",
      manage: "aiqt export all",
      mutationPersistence: "aiqt export all",
    });
  });

  it("aligns in-progress command families on checkpoint", () => {
    const state = stateWithGraph([workUnit({ status: "in_progress" })], {
      currentWorkUnitId: "WU001",
      currentMilestoneId: "M001",
      nextRecommendedCommand: "aiqt checkpoint",
    });

    expect(recommendations(readyProject(), state)).toMatchObject({
      assessment: "aiqt checkpoint",
      status: "aiqt checkpoint",
      startContinue: "aiqt checkpoint",
      review: "aiqt checkpoint",
      manage: "aiqt checkpoint",
      mutationPersistence: "aiqt checkpoint",
    });
  });

  it("aligns needs_review on amend-oriented routing", () => {
    const state = stateWithGraph([workUnit({ status: "needs_review" })], {
      projectStatus: "review",
      nextRecommendedCommand: "aiqt review",
      checkpoints: [
        {
          id: "C001",
          workUnitId: "WU001",
          packetId: "PKT001",
          summary: "Needs review.",
          completed: [],
          notCompleted: [],
          filesChanged: [],
          issues: [],
          validationResult: "failed",
          acceptanceCriteriaResult: "partial",
          validationCommands: [],
          acceptanceCriteria: [],
          finalWorkUnitStatus: "needs_review",
          nextRecommendation: "aiqt review",
          createdAt: NOW,
        },
      ],
    });

    expect(recommendations(readyProject(), state)).toEqual({
      assessment: "aiqt checkpoint amend --checkpoint C001",
      status: "aiqt checkpoint amend --checkpoint C001",
      startContinue: "aiqt checkpoint amend --checkpoint C001",
      review: "aiqt checkpoint amend --checkpoint C001",
      manage: "aiqt checkpoint amend --checkpoint C001",
      mutationPersistence: "aiqt checkpoint amend --checkpoint C001",
    });
  });

  it("aligns planning-ready/no-graph on direct planning", () => {
    expect(recommendations(readyProject(), baseState({ nextRecommendedCommand: "aiqt plan" }))).toEqual({
      assessment: "aiqt plan",
      status: "aiqt plan",
      startContinue: "aiqt plan",
      review: "aiqt plan",
      manage: "aiqt plan",
      mutationPersistence: "aiqt plan",
    });
  });

  it("keeps incomplete context consistent", () => {
    expect(recommendations(baseProject(), baseState({ nextRecommendedCommand: "aiqt update" }))).toEqual({
      assessment: "aiqt update",
      status: "aiqt update",
      startContinue: "aiqt update",
      review: "aiqt update",
      manage: "aiqt update",
      mutationPersistence: "aiqt update",
    });
  });

  it("aligns stale ready owners on graph repair", () => {
    const blocked = workUnit({ id: "WU001", status: "planned" });
    const staleReady = workUnit({ id: "WU002", status: "ready", dependencies: ["DEP001"] });
    const state = stateWithGraph([blocked, staleReady], {}, [dependency({ fromId: "WU001", toId: "WU002" })]);

    expect(recommendations(readyProject(), state)).toMatchObject({
      assessment: "aiqt graph repair --apply",
      status: "aiqt graph repair --apply",
      startContinue: "aiqt graph repair --apply",
      review: "aiqt graph repair --apply",
      manage: "aiqt graph repair --apply",
      mutationPersistence: "aiqt graph repair --apply",
    });
  });

  it("aligns dangling currentWorkUnitId owners on deterministic graph repair", () => {
    const state = stateWithGraph([workUnit({ status: "planned" })], {
      currentWorkUnitId: "WU999",
      currentMilestoneId: "M001",
    });

    expect(recommendations(readyProject(), state)).toMatchObject({
      assessment: "aiqt graph repair --apply",
      status: "aiqt graph repair --apply",
      startContinue: "aiqt graph repair --apply",
      review: "aiqt graph repair --apply",
      manage: "aiqt graph repair --apply",
      mutationPersistence: "aiqt graph repair --apply",
    });
  });
});
