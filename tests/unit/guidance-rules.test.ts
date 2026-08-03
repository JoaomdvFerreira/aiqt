import { describe, it, expect } from "vitest";
import { computeGuidance } from "../../src/workflow/guidance-rules.js";
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

const readyProject = baseProject({
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

const milestone = { id: "M001", title: "m", objective: "o", status: "ready" as const, workUnitIds: ["WU001"] };

describe("computeGuidance", () => {
  it("row 2: recommends aiqt update when planning context is not ready", () => {
    const guidance = computeGuidance({
      project: baseProject(),
      state: baseState(),
      checkpointInputExists: false,
    });
    expect(guidance.stage).toBe("needs_context");
    expect(guidance.recommendedCommand).toBe("aiqt update");
    expect(guidance.canProceedWithoutAgent).toBe(true);
  });

  it("row 3: recommends aiqt plan when context is ready and the graph is empty", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState(),
      checkpointInputExists: false,
    });
    expect(guidance.stage).toBe("needs_plan");
    expect(guidance.recommendedCommand).toBe("aiqt plan");
    expect(guidance.promptCommand).toBe("aiqt prompt plan --out .aiqt/inputs/plan.prompt.md");
    expect(guidance.expectedInputPath).toBe(".aiqt/inputs/plan.json");
    expect(guidance.canProceedWithoutAgent).toBe(true);
  });

  it("row 4: recommends aiqt next when ready work exists and nothing is active", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        workGraph: { milestones: [milestone], workUnits: [workUnit({ status: "ready" })], dependencies: [] },
      }),
      checkpointInputExists: false,
    });
    expect(guidance.stage).toBe("ready_for_handoff");
    expect(guidance.recommendedCommand).toBe("aiqt next");
    expect(guidance.canProceedWithoutAgent).toBe(true);
  });

  it("row 5: recommends aiqt checkpoint when a work unit is in_progress", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        currentWorkUnitId: "WU001",
        workGraph: { milestones: [milestone], workUnits: [workUnit({ status: "in_progress" })], dependencies: [] },
      }),
      checkpointInputExists: false,
    });
    expect(guidance.stage).toBe("awaiting_checkpoint");
    expect(guidance.recommendedCommand).toBe("aiqt checkpoint");
    expect(guidance.promptCommand).toBe("aiqt prompt checkpoint --out .aiqt/inputs/checkpoint.prompt.md");
    expect(guidance.canProceedWithoutAgent).toBe(false);
  });

  it("row 5: canProceedWithoutAgent is true when a checkpoint input file already exists", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        currentWorkUnitId: "WU001",
        workGraph: { milestones: [milestone], workUnits: [workUnit({ status: "in_progress" })], dependencies: [] },
      }),
      checkpointInputExists: true,
    });
    expect(guidance.canProceedWithoutAgent).toBe(true);
  });

  it("row 5 takes priority over row 6 (in_progress wins over an unrelated needs_review unit)", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        currentWorkUnitId: "WU001",
        workGraph: {
          milestones: [milestone, { ...milestone, id: "M002", workUnitIds: ["WU002"] }],
          workUnits: [
            workUnit({ status: "in_progress" }),
            workUnit({ id: "WU002", milestoneId: "M002", status: "needs_review" }),
          ],
          dependencies: [],
        },
      }),
      checkpointInputExists: false,
    });
    expect(guidance.stage).toBe("awaiting_checkpoint");
    expect(guidance.recommendedCommand).toBe("aiqt checkpoint");
  });

  it("row 6: recommends aiqt checkpoint amend when a work unit needs review", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        workGraph: { milestones: [milestone], workUnits: [workUnit({ status: "needs_review" })], dependencies: [] },
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
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      checkpointInputExists: false,
    });
    expect(guidance.stage).toBe("needs_review");
    expect(guidance.recommendedCommand).toBe("aiqt checkpoint amend --checkpoint C001");
    expect(guidance.canProceedWithoutAgent).toBe(true);
  });

  it("row 7: recommends release review when all work is done and production readiness is unknown", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        workGraph: { milestones: [milestone], workUnits: [workUnit({ status: "done" })], dependencies: [] },
      }),
      checkpointInputExists: false,
    });
    expect(guidance.stage).toBe("ready_for_export");
    expect(guidance.recommendedCommand).toBe("aiqt review --mode release");
    expect(guidance.followUpCommand).toBe("aiqt export all");
    expect(guidance.canProceedWithoutAgent).toBe(true);
  });

  it("row 7: recommends export when all work is done and production readiness is true", () => {
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        workGraph: { milestones: [milestone], workUnits: [workUnit({ status: "done" })], dependencies: [] },
      }),
      checkpointInputExists: false,
      productionReady: true,
    });
    expect(guidance.stage).toBe("ready_for_export");
    expect(guidance.recommendedCommand).toBe("aiqt export all");
    expect(guidance.followUpCommand).toBeNull();
  });

  it("falls back to the review next-command precedence for states no row matches", () => {
    // Non-empty graph, no ready/in_progress/needs_review units, not all done:
    // a lone "planned" work unit blocked on unmet dependencies.
    const guidance = computeGuidance({
      project: readyProject,
      state: baseState({
        workGraph: { milestones: [milestone], workUnits: [workUnit({ status: "planned" })], dependencies: [] },
      }),
      checkpointInputExists: false,
    });
    expect(guidance.recommendedCommand).toBeNull();
  });
});
