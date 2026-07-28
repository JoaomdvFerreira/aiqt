import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeEvidenceAdvisoryTelemetry } from "../../src/workflow/evidence-advisory-telemetry.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ProjectIssue } from "../../src/schema/project-issue.schema.js";
import { makeTempDir, removeDir } from "../helpers.js";

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1",
    projectStatus: "in_progress",
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

function advisoryIssue(issueKey: string, overrides: Partial<ProjectIssue> = {}): ProjectIssue {
  return {
    projectIssueId: `PI-${issueKey}`,
    issueKey,
    title: "Evidence gate advisory finding",
    description: "d",
    severity: "high",
    sourceType: "checkpoint",
    sourceRefs: [],
    affectedWorkUnitIds: [],
    affectedMilestoneIds: [],
    evidenceIds: [],
    checkpointRefs: [],
    ownerRef: null,
    promotionRefs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function writeRunlog(path: string, events: { type: string; data: Record<string, unknown> }[]): void {
  const lines = events.map((e, i) =>
    JSON.stringify({
      id: `EVT-${i + 1}`,
      type: e.type,
      timestamp: "2026-01-01T00:00:00.000Z",
      actor: "cli",
      summary: "s",
      relatedIds: [],
      data: e.data,
    }),
  );
  writeFileSync(path, lines.join("\n") + "\n");
}

function feedbackEvent(issueKey: string, classification: string) {
  return { type: "evidence_gate.advisory_feedback_recorded", data: { issueKey, classification } };
}

describe("computeEvidenceAdvisoryTelemetry: feedback.unclassified correction (Gate J defect)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("4 advisory issues, 3 with feedback -> unclassified = 1", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeRunlog(runlogPath, [
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "confirmed"),
      feedbackEvent("checkpoint:C001:advisory:abc:rule-b", "false_positive"),
      feedbackEvent("checkpoint:C002:advisory:abc:rule-a", "policy_gap"),
    ]);
    const state = baseState({
      issues: {
        overrides: [],
        promotions: [],
        projectIssues: [
          advisoryIssue("checkpoint:C001:advisory:abc:rule-a"),
          advisoryIssue("checkpoint:C001:advisory:abc:rule-b"),
          advisoryIssue("checkpoint:C002:advisory:abc:rule-a"),
          advisoryIssue("checkpoint:C002:advisory:abc:rule-b"),
        ],
      },
    });
    const telemetry = computeEvidenceAdvisoryTelemetry(state, runlogPath);
    expect(telemetry.feedback).toEqual({
      confirmed: 1,
      falsePositive: 1,
      policyGap: 1,
      evidenceMissing: 0,
      unclassified: 1,
    });
  });

  it("feedback added to the final unclassified issue -> unclassified = 0", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeRunlog(runlogPath, [
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "confirmed"),
      feedbackEvent("checkpoint:C001:advisory:abc:rule-b", "false_positive"),
      feedbackEvent("checkpoint:C002:advisory:abc:rule-a", "policy_gap"),
      feedbackEvent("checkpoint:C002:advisory:abc:rule-b", "evidence_missing"),
    ]);
    const state = baseState({
      issues: {
        overrides: [],
        promotions: [],
        projectIssues: [
          advisoryIssue("checkpoint:C001:advisory:abc:rule-a"),
          advisoryIssue("checkpoint:C001:advisory:abc:rule-b"),
          advisoryIssue("checkpoint:C002:advisory:abc:rule-a"),
          advisoryIssue("checkpoint:C002:advisory:abc:rule-b"),
        ],
      },
    });
    const telemetry = computeEvidenceAdvisoryTelemetry(state, runlogPath);
    expect(telemetry.feedback.unclassified).toBe(0);
    expect(telemetry.feedback.evidenceMissing).toBe(1);
  });

  it("feedback classification updated -> classified buckets move, classified total unchanged", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeRunlog(runlogPath, [
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "confirmed"),
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "evidence_missing"), // update, same issueKey
    ]);
    const state = baseState({
      issues: { overrides: [], promotions: [], projectIssues: [advisoryIssue("checkpoint:C001:advisory:abc:rule-a")] },
    });
    const telemetry = computeEvidenceAdvisoryTelemetry(state, runlogPath);
    expect(telemetry.feedback).toEqual({ confirmed: 0, falsePositive: 0, policyGap: 0, evidenceMissing: 1, unclassified: 0 });
  });

  it("identical feedback replay -> counts unchanged", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeRunlog(runlogPath, [
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "confirmed"),
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "confirmed"), // replay no-op
    ]);
    const state = baseState({
      issues: { overrides: [], promotions: [], projectIssues: [advisoryIssue("checkpoint:C001:advisory:abc:rule-a")] },
    });
    const telemetry = computeEvidenceAdvisoryTelemetry(state, runlogPath);
    expect(telemetry.feedback).toEqual({ confirmed: 1, falsePositive: 0, policyGap: 0, evidenceMissing: 0, unclassified: 0 });
  });

  it("a non-advisory ProjectIssue is excluded from both the denominator and any classification bucket", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeRunlog(runlogPath, [feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "confirmed")]);
    const state = baseState({
      issues: {
        overrides: [],
        promotions: [],
        projectIssues: [
          advisoryIssue("checkpoint:C001:advisory:abc:rule-a"),
          // Evidence-import-sourced issue, not M29 advisory-routed -- must not count toward the denominator.
          advisoryIssue("evidence:project:some-other-finding", { sourceType: "evidence" }),
        ],
      },
    });
    const telemetry = computeEvidenceAdvisoryTelemetry(state, runlogPath);
    expect(telemetry.feedback).toEqual({ confirmed: 1, falsePositive: 0, policyGap: 0, evidenceMissing: 0, unclassified: 0 });
  });

  it("a duplicate feedback runlog event for the same issueKey does not double-count", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeRunlog(runlogPath, [
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "false_positive"),
      feedbackEvent("checkpoint:C001:advisory:abc:rule-a", "false_positive"), // exact duplicate event
    ]);
    const state = baseState({
      issues: { overrides: [], promotions: [], projectIssues: [advisoryIssue("checkpoint:C001:advisory:abc:rule-a")] },
    });
    const telemetry = computeEvidenceAdvisoryTelemetry(state, runlogPath);
    expect(telemetry.feedback.falsePositive).toBe(1);
  });

  it("an advisory issue with no feedback at all is counted as unclassified", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeRunlog(runlogPath, []);
    const state = baseState({
      issues: { overrides: [], promotions: [], projectIssues: [advisoryIssue("checkpoint:C001:advisory:abc:rule-a")] },
    });
    const telemetry = computeEvidenceAdvisoryTelemetry(state, runlogPath);
    expect(telemetry.feedback).toEqual({ confirmed: 0, falsePositive: 0, policyGap: 0, evidenceMissing: 0, unclassified: 1 });
  });
});
