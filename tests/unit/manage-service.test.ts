import { describe, it, expect } from "vitest";
import {
  classifyFindings,
  findingsForMode,
  getAcknowledgedFindings,
  isFindingAcknowledged,
  buildManageReport,
} from "../../src/services/manage-service.js";
import { runReview, type ReviewResult } from "../../src/services/review-service.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";
import type { AcknowledgedFinding } from "../../src/schema/review-acknowledgment.schema.js";

const DOGFOOD_KEY = "checkpoint:WU003:acceptanceCriteriaResult:partial";

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

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "review",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: {
      milestones: [{ id: "M001", title: "m", objective: "o", status: "done", workUnitIds: ["WU003"] }],
      workUnits: [workUnit({ status: "done" })],
      dependencies: [],
    },
    checkpoints: [checkpoint({ acceptanceCriteriaResult: "partial" })],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function reviewFor(project: ProjectModel, state: StateModel): ReviewResult {
  // Pass every checkpoint's packetId as "known" so the integrity collector's
  // checkpoint-missing-packet rule does not add an unrelated blocking
  // finding on top of the one under test.
  const knownPacketIds = state.checkpoints
    .map((c) => c.packetId)
    .filter((id): id is string => id !== null);
  return runReview(project, state, knownPacketIds);
}

describe("getAcknowledgedFindings", () => {
  it("returns an empty array when state.review is missing entirely", () => {
    const state = baseState();
    expect(getAcknowledgedFindings(state)).toEqual([]);
  });

  it("returns the stored acknowledgment list when present", () => {
    const ack: AcknowledgedFinding = {
      findingKey: DOGFOOD_KEY,
      reason: "r",
      acknowledgedAt: "2026-01-01T00:00:00.000Z",
      sourceCommand: "aiqt review acknowledge",
    };
    const state = baseState({ review: { acknowledgedFindings: [ack] } });
    expect(getAcknowledgedFindings(state)).toEqual([ack]);
  });
});

describe("isFindingAcknowledged", () => {
  it("is false for an empty acknowledgment list", () => {
    expect(isFindingAcknowledged(DOGFOOD_KEY, [])).toBe(false);
  });

  it("is true when the finding key matches a stored acknowledgment", () => {
    const ack: AcknowledgedFinding = {
      findingKey: DOGFOOD_KEY,
      reason: "r",
      acknowledgedAt: "2026-01-01T00:00:00.000Z",
      sourceCommand: "aiqt review acknowledge",
    };
    expect(isFindingAcknowledged(DOGFOOD_KEY, [ack])).toBe(true);
  });
});

describe("classifyFindings", () => {
  it("developmentComplete is false and productionReady is false before acknowledgment", () => {
    const project = baseProject();
    const state = baseState();
    const classification = classifyFindings(project, state, reviewFor(project, state));
    expect(classification.developmentComplete).toBe(false);
    expect(classification.productionReady).toBe(false);
    expect(classification.unacknowledgedBlockingFindings.length).toBeGreaterThan(0);
  });

  it("developmentComplete becomes true once the blocking finding is acknowledged, but productionReady stays false", () => {
    const project = baseProject();
    const state = baseState({
      review: {
        acknowledgedFindings: [
          {
            findingKey: DOGFOOD_KEY,
            reason: "Live Clerk verification requires user-owned setup.",
            acknowledgedAt: "2026-01-01T00:00:00.000Z",
            sourceCommand: "aiqt review acknowledge",
          },
        ],
      },
    });
    const classification = classifyFindings(project, state, reviewFor(project, state));
    expect(classification.developmentComplete).toBe(true);
    expect(classification.productionReady).toBe(false);
    expect(classification.unacknowledgedBlockingFindings).toHaveLength(0);
    expect(classification.blockingFindingsIgnoringAcknowledgment.length).toBeGreaterThan(0);
  });

  it("acknowledged findings remain visible in activeFindings with acknowledged: true", () => {
    const project = baseProject();
    const state = baseState({
      review: {
        acknowledgedFindings: [
          {
            findingKey: DOGFOOD_KEY,
            reason: "r",
            acknowledgedAt: "2026-01-01T00:00:00.000Z",
            sourceCommand: "aiqt review acknowledge",
          },
        ],
      },
    });
    const classification = classifyFindings(project, state, reviewFor(project, state));
    const finding = classification.activeFindings.find((f) => f.findingKey === DOGFOOD_KEY);
    expect(finding).toBeDefined();
    expect(finding?.acknowledged).toBe(true);
  });

  it("externalVerificationGaps includes checkpoint:-prefixed findings", () => {
    const project = baseProject();
    const state = baseState();
    const classification = classifyFindings(project, state, reviewFor(project, state));
    expect(classification.externalVerificationGaps.some((s) => s.includes(DOGFOOD_KEY))).toBe(true);
  });

  it("developmentComplete is false when work remains ready/planned even with no blocking findings", () => {
    const project = baseProject();
    const state = baseState({
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "ready", workUnitIds: ["WU001"] }],
        workUnits: [
          workUnit({
            id: "WU001",
            status: "ready",
            title: "Do the thing",
            validationCommands: ["pnpm test"],
          }),
        ],
        dependencies: [],
      },
      checkpoints: [],
    });
    const classification = classifyFindings(project, state, reviewFor(project, state));
    expect(classification.developmentComplete).toBe(false);
  });
});

describe("findingsForMode", () => {
  it("release mode returns all findings regardless of acknowledgment", () => {
    const project = baseProject();
    const state = baseState({
      review: {
        acknowledgedFindings: [
          {
            findingKey: DOGFOOD_KEY,
            reason: "r",
            acknowledgedAt: "2026-01-01T00:00:00.000Z",
            sourceCommand: "aiqt review acknowledge",
          },
        ],
      },
    });
    const review = reviewFor(project, state);
    const forRelease = findingsForMode(review, getAcknowledgedFindings(state), "release");
    expect(forRelease.some((f) => f.findingKey === DOGFOOD_KEY && f.blocking)).toBe(true);
  });

  it("development mode excludes acknowledged blocking findings", () => {
    const project = baseProject();
    const acknowledged: AcknowledgedFinding[] = [
      {
        findingKey: DOGFOOD_KEY,
        reason: "r",
        acknowledgedAt: "2026-01-01T00:00:00.000Z",
        sourceCommand: "aiqt review acknowledge",
      },
    ];
    const state = baseState({ review: { acknowledgedFindings: acknowledged } });
    const review = reviewFor(project, state);
    const forDevelopment = findingsForMode(review, acknowledged, "development");
    expect(forDevelopment.some((f) => f.blocking)).toBe(false);
  });
});

describe("buildManageReport", () => {
  it("reports developmentComplete=true and productionReady=false for the acknowledged dogfood terminal state", () => {
    const project = baseProject();
    const state = baseState({
      review: {
        acknowledgedFindings: [
          {
            findingKey: DOGFOOD_KEY,
            reason: "Live Clerk verification requires user-owned setup.",
            acknowledgedAt: "2026-01-01T00:00:00.000Z",
            sourceCommand: "aiqt review acknowledge",
          },
        ],
      },
    });
    const review = reviewFor(project, state);
    const report = buildManageReport(project, state, review);
    expect(report.developmentComplete).toBe(true);
    expect(report.productionReady).toBe(false);
    // M10 §10.1: developmentComplete && !productionReady with release
    // blockers present recommends "aiqt manage" (not "aiqt review --mode
    // release" directly), so the terminal-state guidance loop does not just
    // point back at review and repeat the same blocker.
    expect(report.recommendedCommand).toBe("aiqt manage");
    expect(report.reason).toBe("Development is complete but production readiness still has release blockers or gaps.");
  });

  it("recommends aiqt export all once fully production ready", () => {
    const project = baseProject();
    const state = baseState({ checkpoints: [checkpoint({ acceptanceCriteriaResult: "passed" })] });
    const review = reviewFor(project, state);
    const report = buildManageReport(project, state, review);
    expect(report.developmentComplete).toBe(true);
    expect(report.productionReady).toBe(true);
    expect(report.recommendedCommand).toBe("aiqt export all");
    expect(report.reason).toBe("Development and production readiness are complete; export/reporting is available.");
  });
});
