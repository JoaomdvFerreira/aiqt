import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { IssueStateSchema } from "../../src/schema/issue-state.schema.js";
import { EvidenceStateSchema } from "../../src/schema/evidence.schema.js";
import { DecisionEscalationSchema } from "../../src/schema/decision-escalation.schema.js";
import {
  getProjectIssues,
  getProjectIssueTransitions,
  findProjectIssueByKey,
} from "../../src/services/project-issue-service.js";
import {
  getEvidenceRecords,
  getDecisionEscalations,
  findEvidenceRecordById,
  findDecisionEscalationByKey,
} from "../../src/services/evidence-service.js";
import { FIXTURES_DIR } from "../helpers.js";

const NOW = "2026-01-01T00:00:00.000Z";

describe("M22-WU02: ProjectIssue/Evidence schema foundation", () => {
  it("EvidenceStateSchema accepts an empty records/decisionEscalations collection", () => {
    expect(EvidenceStateSchema.safeParse({ records: [], decisionEscalations: [] }).success).toBe(true);
  });

  it("DecisionEscalationSchema accepts a minimal valid record", () => {
    const value = { escalationId: "DE-001", escalationKey: "k", createdAt: NOW, updatedAt: NOW };
    expect(DecisionEscalationSchema.safeParse(value).success).toBe(true);
  });

  it("IssueStateSchema remains valid with projectIssues/projectIssueTransitions omitted", () => {
    expect(IssueStateSchema.safeParse({ overrides: [], promotions: [] }).success).toBe(true);
  });

  it("StateModelSchema remains valid with evidence omitted entirely", () => {
    const base = {
      version: "0.5.0",
      projectStatus: "draft",
      currentMilestoneId: null,
      currentWorkUnitId: null,
      workGraph: { milestones: [], workUnits: [], dependencies: [] },
      checkpoints: [],
      lastAgentPacket: null,
      nextRecommendedCommand: null,
      lastUpdatedAt: NOW,
    };
    expect(StateModelSchema.safeParse(base).success).toBe(true);
  });

  it("getProjectIssues/getProjectIssueTransitions/getEvidenceRecords/getDecisionEscalations default to [] when absent", () => {
    const state = StateModelSchema.parse({
      version: "0.5.0",
      projectStatus: "draft",
      currentMilestoneId: null,
      currentWorkUnitId: null,
      workGraph: { milestones: [], workUnits: [], dependencies: [] },
      checkpoints: [],
      lastAgentPacket: null,
      nextRecommendedCommand: null,
      lastUpdatedAt: NOW,
    });
    expect(getProjectIssues(state)).toEqual([]);
    expect(getProjectIssueTransitions(state)).toEqual([]);
    expect(getEvidenceRecords(state)).toEqual([]);
    expect(getDecisionEscalations(state)).toEqual([]);
    expect(findProjectIssueByKey("missing", [])).toBeUndefined();
    expect(findEvidenceRecordById("missing", [])).toBeUndefined();
    expect(findDecisionEscalationByKey("missing", [])).toBeUndefined();
  });

  it("historical pre-M9 state fixture (no issues/evidence/checkpointAmendments) parses without a schema-version bump and yields empty M22 collections", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "initialized-project", ".aiqt", "state.json"), "utf8");
    const parsed = StateModelSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.issues).toBeUndefined();
    expect(parsed.data.evidence).toBeUndefined();
    expect(getProjectIssues(parsed.data)).toEqual([]);
    expect(getEvidenceRecords(parsed.data)).toEqual([]);
  });
});
