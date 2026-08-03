import { describe, expect, it } from "vitest";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import { buildManageReport } from "../../src/services/manage-service.js";
import type { ReviewResult } from "../../src/services/review-service.js";
import { computeGuidance } from "../../src/workflow/guidance-rules.js";
import { computeNextAction } from "../../src/workflow/next-action.js";
import { computeReviewNextCommand } from "../../src/workflow/review-next-command.js";

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
  const reviewNext = computeReviewNextCommand(project, state, []);
  return {
    status: computeNextAction(project, state).nextRecommendedCommand,
    startContinue: computeGuidance({ project, state, checkpointInputExists: false }).recommendedCommand,
    review: reviewNext,
    manage: buildManageReport(project, state, emptyReview(reviewNext)).recommendedCommand,
    persisted: state.nextRecommendedCommand,
  };
}

describe("WU32-01 workflow recommendation characterization", () => {
  it("pins all-done disagreement across existing owners", () => {
    const state = stateWithGraph([workUnit({ status: "done" })], {
      projectStatus: "review",
      nextRecommendedCommand: "aiqt review",
    });

    expect(recommendations(readyProject(), state)).toEqual({
      status: "aiqt manage",
      startContinue: "aiqt review",
      review: "aiqt export all",
      manage: "aiqt export all",
      persisted: "aiqt review",
    });
  });

  it("pins in-progress command-family disagreement", () => {
    const state = stateWithGraph([workUnit({ status: "in_progress" })], {
      currentWorkUnitId: "WU001",
      currentMilestoneId: "M001",
      nextRecommendedCommand: "aiqt checkpoint",
    });

    expect(recommendations(readyProject(), state)).toMatchObject({
      status: "aiqt checkpoint",
      startContinue: "aiqt prompt checkpoint",
      review: "aiqt checkpoint",
      manage: "aiqt checkpoint",
      persisted: "aiqt checkpoint",
    });
  });

  it("pins needs_review looping through review instead of an amend-oriented route", () => {
    const state = stateWithGraph([workUnit({ status: "needs_review" })], {
      projectStatus: "review",
      nextRecommendedCommand: "aiqt review",
    });

    expect(recommendations(readyProject(), state)).toEqual({
      status: "aiqt review",
      startContinue: "aiqt review",
      review: "aiqt review",
      manage: "aiqt review",
      persisted: "aiqt review",
    });
  });

  it("pins planning-ready/no-graph disagreement between direct and prompt planning", () => {
    expect(recommendations(readyProject(), baseState({ nextRecommendedCommand: "aiqt plan" }))).toEqual({
      status: "aiqt plan",
      startContinue: "aiqt prompt plan",
      review: "aiqt plan",
      manage: "aiqt plan",
      persisted: "aiqt plan",
    });
  });

  it("pins incomplete context as the one broadly consistent pre-plan state", () => {
    expect(recommendations(baseProject(), baseState({ nextRecommendedCommand: "aiqt update" }))).toEqual({
      status: "aiqt update",
      startContinue: "aiqt update",
      review: "aiqt update",
      manage: "aiqt update",
      persisted: "aiqt update",
    });
  });

  it("pins stale ready disagreement caused by canonical-ready checks outside effective readiness", () => {
    const blocked = workUnit({ id: "WU001", status: "planned" });
    const staleReady = workUnit({ id: "WU002", status: "ready", dependencies: ["DEP001"] });
    const state = stateWithGraph([blocked, staleReady], {}, [dependency({ fromId: "WU001", toId: "WU002" })]);

    expect(recommendations(readyProject(), state)).toMatchObject({
      status: "aiqt review",
      startContinue: "aiqt next",
      review: "aiqt review",
      manage: "aiqt review",
    });
  });

  it("pins dangling currentWorkUnitId disagreement between pointer-truthiness and referenced status checks", () => {
    const state = stateWithGraph([workUnit({ status: "planned" })], {
      currentWorkUnitId: "WU999",
      currentMilestoneId: "M001",
    });

    expect(recommendations(readyProject(), state)).toMatchObject({
      status: "aiqt checkpoint",
      startContinue: "aiqt review",
      review: "aiqt review",
      manage: "aiqt review",
    });
  });
});
