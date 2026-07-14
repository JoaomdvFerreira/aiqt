import { describe, it, expect } from "vitest";
import {
  collectCheckpointFindings,
  collectContextFindings,
  collectIntegrityFindings,
  collectQualityFindings,
  collectWorkflowFindings,
} from "../../src/workflow/review-rules.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";

function baseProject(overrides: Partial<ProjectModel> = {}): ProjectModel {
  return {
    version: "1.0.0",
    project: {
      id: "PROJECT-001",
      name: "Test",
      objective: "Ship it",
      targetUsers: ["devs"],
      preferredAgent: null,
      existingRepositoryPath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    context: {
      constraints: ["Local files are the source of truth"],
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
    projectStatus: "review",
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
    id: "WU003",
    milestoneId: "M001",
    title: "t",
    objective: "o",
    scope: ["s"],
    outOfScope: ["oos"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "done",
    dependencies: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function checkpoint(overrides: Partial<Checkpoint>): Checkpoint {
  return {
    id: "C001",
    workUnitId: "WU003",
    packetId: "PKT-003",
    summary: "s",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    issues: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "partial",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "done",
    nextRecommendation: "aiqt review",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("finding key determinism (M9 §7.3)", () => {
  it("produces the required dogfood key checkpoint:WU003:acceptanceCriteriaResult:partial", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU003"] }],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
      checkpoints: [checkpoint({ acceptanceCriteriaResult: "partial" })],
    });
    const findings = collectCheckpointFindings(baseProject(), state);
    const finding = findings.find((f) => f.findingKey === "checkpoint:WU003:acceptanceCriteriaResult:partial");
    expect(finding).toBeDefined();
    expect(finding?.blocking).toBe(true);
  });

  it("is stable and deterministic across repeated runs on identical state", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU003"] }],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
      checkpoints: [checkpoint({ acceptanceCriteriaResult: "partial" })],
    });
    const first = collectCheckpointFindings(baseProject(), state).map((f) => f.findingKey);
    const second = collectCheckpointFindings(baseProject(), state).map((f) => f.findingKey);
    expect(first).toEqual(second);
  });

  it("does not vary with display order (findingKey is independent of FIND-### assignment)", () => {
    const stateA = baseState({
      workGraph: {
        milestones: [
          { id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU001", "WU003"] },
        ],
        workUnits: [
          workUnit({ id: "WU001", status: "done" }),
          workUnit({ id: "WU003", status: "done" }),
        ],
        dependencies: [],
      },
      checkpoints: [
        checkpoint({ id: "C001", workUnitId: "WU001", acceptanceCriteriaResult: "passed" }),
        checkpoint({ id: "C002", workUnitId: "WU003", acceptanceCriteriaResult: "partial" }),
      ],
    });
    const findings = collectCheckpointFindings(baseProject(), stateA);
    const wu003Finding = findings.find((f) => f.relatedIds.includes("WU003") && f.blocking);
    expect(wu003Finding?.findingKey).toBe("checkpoint:WU003:acceptanceCriteriaResult:partial");
  });

  it("uses the checkpoint:<workUnitId>:validationResult:<value> pattern for validation failures", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU003"] }],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
      checkpoints: [checkpoint({ validationResult: "failed", acceptanceCriteriaResult: "passed" })],
    });
    const findings = collectCheckpointFindings(baseProject(), state);
    expect(findings.some((f) => f.findingKey === "checkpoint:WU003:validationResult:failed")).toBe(true);
  });

  it("uses workunit:<id>:<rule> for done-without-checkpoint", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU003"] }],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
    });
    const findings = collectCheckpointFindings(baseProject(), state);
    expect(findings.some((f) => f.findingKey === "workunit:WU003:done-no-checkpoint")).toBe(true);
  });

  it("uses dependency:<id>:<rule> for broken dependency references", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "ready", workUnitIds: ["WU003"] }],
        workUnits: [workUnit({ status: "ready" })],
        dependencies: [{ id: "DEP-001", fromId: "WU003", toId: "WU999", type: "blocks", reason: null }],
      },
    });
    const findings = collectIntegrityFindings(baseProject(), state, []);
    expect(findings.some((f) => f.findingKey === "dependency:DEP-001:unknown-workunit-ref")).toBe(true);
  });

  it("uses state:<field>-empty for context findings", () => {
    const findings = collectContextFindings(baseProject({
      project: { ...baseProject().project, objective: "" },
    }), baseState());
    expect(findings.some((f) => f.findingKey === "state:project:objective-empty")).toBe(true);
  });

  it("uses workunit:<id>:no-validation-commands for a ready unit with no validation commands", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "ready", workUnitIds: ["WU003"] }],
        workUnits: [workUnit({ status: "ready", validationCommands: [] })],
        dependencies: [],
      },
    });
    const findings = collectQualityFindings(baseProject(), state);
    expect(findings.some((f) => f.findingKey === "workunit:WU003:no-validation-commands")).toBe(true);
  });

  it("uses review:<rule> for project-wide workflow-position findings", () => {
    const findings = collectWorkflowFindings(baseProject(), baseState());
    expect(findings.some((f) => f.findingKey === "review:empty-work-graph")).toBe(true);
  });

  it("every findingKey uses lowercase category prefixes and colon separators", () => {
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU003"] }],
        workUnits: [workUnit({ status: "done" })],
        dependencies: [],
      },
      checkpoints: [checkpoint({ acceptanceCriteriaResult: "partial" })],
    });
    const findings = [
      ...collectIntegrityFindings(baseProject(), state, []),
      ...collectWorkflowFindings(baseProject(), state),
      ...collectContextFindings(baseProject(), state),
      ...collectQualityFindings(baseProject(), state),
      ...collectCheckpointFindings(baseProject(), state),
    ];
    for (const finding of findings) {
      expect(finding.findingKey).toMatch(/^[a-z]+:/);
      expect(finding.findingKey).not.toMatch(/^FIND-/);
    }
  });
});
