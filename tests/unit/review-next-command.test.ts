import { describe, it, expect } from "vitest";
import { computeReviewNextCommand } from "../../src/workflow/review-next-command.js";
import { computeRecommendedExportTargets } from "../../src/services/review-service.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";

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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
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
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function workUnit(overrides: Partial<WorkUnit>): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "t",
    objective: "o",
    scope: ["s"],
    outOfScope: ["oos"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeReviewNextCommand", () => {
  it("recommends aiqt review when a blocking finding exists, overriding all other signals", () => {
    const project = baseProject();
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [workUnit({ status: "ready" })],
        dependencies: [],
      },
    });
    const cmd = computeReviewNextCommand(project, state, [
      {
        id: "FIND-001",
        category: "integrity",
        severity: "critical",
        blocking: true,
        title: "t",
        message: "m",
        relatedIds: [],
        suggestedAction: "a",
        nextRecommendedCommand: "aiqt review",
      },
    ]);
    expect(cmd).toBe("aiqt review");
  });

  it("recommends aiqt checkpoint when the current work unit is in_progress", () => {
    const project = baseProject();
    const state = baseState({
      currentWorkUnitId: "WU001",
      workGraph: {
        milestones: [],
        workUnits: [workUnit({ status: "in_progress" })],
        dependencies: [],
      },
    });
    expect(computeReviewNextCommand(project, state, [])).toBe("aiqt checkpoint");
  });

  it("recommends aiqt update when the graph is empty and context is not ready", () => {
    const project = baseProject();
    const state = baseState();
    expect(computeReviewNextCommand(project, state, [])).toBe("aiqt update");
  });

  it("recommends aiqt plan when the graph is empty and context is ready", () => {
    const project = baseProject({
      project: {
        ...baseProject().project,
        objective: "Ship it",
        targetUsers: ["devs"],
      },
      context: {
        constraints: ["Local files are the source of truth"],
        nonGoals: [],
        technologyPreferences: [],
        businessRules: [],
        architectureNotes: [],
      },
    });
    const state = baseState();
    expect(computeReviewNextCommand(project, state, [])).toBe("aiqt plan");
  });

  it("recommends aiqt next when a ready work unit exists and nothing is active", () => {
    const project = baseProject();
    const state = baseState({
      workGraph: {
        milestones: [
          { id: "M001", title: "m", objective: "o", status: "ready", workUnitIds: ["WU001"] },
        ],
        workUnits: [workUnit({ status: "ready" })],
        dependencies: [],
      },
    });
    expect(computeReviewNextCommand(project, state, [])).toBe("aiqt next");
  });

  it("recommends aiqt export status-report when every work unit is done", () => {
    const project = baseProject();
    const state = baseState({
      workGraph: {
        milestones: [
          { id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU001"] },
        ],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
    });
    expect(computeReviewNextCommand(project, state, [])).toBe("aiqt export status-report");
  });
});

describe("computeRecommendedExportTargets", () => {
  it("recommends only project-plan when no work graph exists", () => {
    const project = baseProject();
    const state = baseState();
    expect(computeRecommendedExportTargets(project, state)).toEqual(["project-plan"]);
  });

  it("recommends project-plan and technical-spec once a work graph exists with no checkpoints", () => {
    const project = baseProject();
    const state = baseState({
      workGraph: {
        milestones: [
          { id: "M001", title: "m", objective: "o", status: "ready", workUnitIds: ["WU001"] },
        ],
        workUnits: [workUnit({ status: "ready" })],
        dependencies: [],
      },
    });
    expect(computeRecommendedExportTargets(project, state)).toEqual([
      "project-plan",
      "technical-spec",
    ]);
  });

  it("recommends status-report and project-plan once checkpoints exist", () => {
    const project = baseProject();
    const state = baseState({
      workGraph: {
        milestones: [],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
      checkpoints: [
        {
          id: "C001",
          workUnitId: "WU001",
          packetId: "PKT-001",
          issues: [],
          validationResult: "passed",
          acceptanceCriteriaResult: "passed",
          validationCommands: [],
          acceptanceCriteria: [],
          finalWorkUnitStatus: "done",
          nextRecommendation: "n",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(computeRecommendedExportTargets(project, state)).toEqual([
      "project-plan",
      "status-report",
    ]);
  });

  it("never emits project-summary", () => {
    const project = baseProject();
    const state = baseState({ projectStatus: "review" });
    expect(computeRecommendedExportTargets(project, state)).not.toContain("project-summary");
  });
});
