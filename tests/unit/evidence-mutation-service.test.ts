import { describe, it, expect } from "vitest";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { EvidenceRecord } from "../../src/schema/evidence.schema.js";
import { EVIDENCE_RECORDS_HARD_CAP } from "../../src/schema/evidence.schema.js";
import type { DecisionEscalation } from "../../src/schema/decision-escalation.schema.js";
import {
  buildRecordEvidenceCandidate,
  buildRecordDecisionEscalationCandidate,
  getEvidenceRecords,
  getDecisionEscalations,
} from "../../src/services/evidence-service.js";

const T1 = "2026-01-01T00:00:00.000Z";

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "T",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "ready", workUnitIds: ["WU001"], ...overrides };
}

function stateWithGraph(workUnits: WorkUnit[], milestones: Milestone[]): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workGraph: { milestones, workUnits, dependencies: [] } };
}

function makeEvidence(overrides: Partial<Record<string, unknown>> = {}): EvidenceRecord {
  return {
    evidenceId: "EVID-001",
    contractVersion: "1.0",
    provider: { providerId: "reviewer-1", providerType: "human", trustLevel: "repository_local" },
    workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1" },
    codeBinding: { commitSha: "abc123", capturedAt: T1 },
    reviewer: { reviewerType: "human", independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    sourceFindings: [],
    decisionEscalationIds: [],
    artifactReferences: [],
    recordedAt: T1,
    ...overrides,
  } as EvidenceRecord;
}

function makeEscalation(overrides: Partial<Record<string, unknown>> = {}): DecisionEscalation {
  return {
    escalationId: "DE-001",
    escalationKey: "escalation:architecture:x",
    category: "architecture",
    status: "open",
    question: "q",
    rationale: "r",
    relatedWorkUnitIds: [],
    relatedMilestoneIds: [],
    evidenceIds: [],
    resolution: null,
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  } as DecisionEscalation;
}

describe("buildRecordEvidenceCandidate (M22-WU08 / spec §7.1-§7.4)", () => {
  it("records new evidence, returns changed: true and a real runlog event", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordEvidenceCandidate({ state, evidence: makeEvidence(), timestamp: T1, eventId: "EVT-001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.state.records).toHaveLength(1);
    expect(result.runlogEvent?.type).toBe("evidence.recorded");
    expect(result.runlogEvent?.data?.evidenceId).toBe("EVID-001");
  });

  it("is idempotent on a repeated evidenceId: changed false, no second record, no runlog event", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const first = buildRecordEvidenceCandidate({ state, evidence: makeEvidence(), timestamp: T1, eventId: "EVT-001" });
    expect(first.ok && first.changed).toBe(true);
    if (!first.ok) return;
    const stateAfterFirst = { ...state, evidence: first.state };
    const second = buildRecordEvidenceCandidate({
      state: stateAfterFirst,
      evidence: makeEvidence(),
      timestamp: T1,
      eventId: "EVT-002",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.state.records).toHaveLength(1);
    expect(second.runlogEvent).toBeNull();
  });

  it("rejects an unknown work unit reference with no mutation (ok: false)", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordEvidenceCandidate({
      state,
      evidence: makeEvidence({ workflowBinding: { workUnitId: "WU999", packetId: "PKT-001", implementationRootId: "ROOT-1" } }),
      timestamp: T1,
      eventId: "EVT-001",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown checkpoint reference with no mutation", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordEvidenceCandidate({
      state,
      evidence: makeEvidence({
        workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: "C999", implementationRootId: "ROOT-1" },
      }),
      timestamp: T1,
      eventId: "EVT-001",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown decision-escalation reference with no mutation", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordEvidenceCandidate({
      state,
      evidence: makeEvidence({ decisionEscalationIds: ["DE-999"] }),
      timestamp: T1,
      eventId: "EVT-001",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a known decision-escalation reference", () => {
    const escalation = makeEscalation();
    const base = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const state = { ...base, evidence: { records: [], decisionEscalations: [escalation] } };
    const result = buildRecordEvidenceCandidate({
      state,
      evidence: makeEvidence({ decisionEscalationIds: [escalation.escalationId] }),
      timestamp: T1,
      eventId: "EVT-001",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects recording when the evidence_records_hard_cap is already reached", () => {
    const base = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const padded = Array.from({ length: EVIDENCE_RECORDS_HARD_CAP }, (_, i) => makeEvidence({ evidenceId: `EVID-${i}` }));
    const state = { ...base, evidence: { records: padded, decisionEscalations: [] } };
    const result = buildRecordEvidenceCandidate({ state, evidence: makeEvidence({ evidenceId: "EVID-new" }), timestamp: T1, eventId: "EVT-001" });
    expect(result.ok).toBe(false);
  });

  it("does not mutate the input state object (pure function)", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const before = getEvidenceRecords(state);
    buildRecordEvidenceCandidate({ state, evidence: makeEvidence(), timestamp: T1, eventId: "EVT-001" });
    expect(getEvidenceRecords(state)).toEqual(before);
    expect(getEvidenceRecords(state)).toHaveLength(0);
  });
});

describe("buildRecordDecisionEscalationCandidate (M22-WU08 / spec §7.1-§7.4)", () => {
  it("records a new escalation, returns changed: true and a real runlog event", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordDecisionEscalationCandidate({ state, escalation: makeEscalation(), timestamp: T1, eventId: "EVT-001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.state.decisionEscalations).toHaveLength(1);
    expect(result.runlogEvent?.type).toBe("decision_escalation.created");
  });

  it("is idempotent on a repeated escalationKey", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const first = buildRecordDecisionEscalationCandidate({ state, escalation: makeEscalation(), timestamp: T1, eventId: "EVT-001" });
    expect(first.ok && first.changed).toBe(true);
    if (!first.ok) return;
    const stateAfterFirst = { ...state, evidence: first.state };
    const second = buildRecordDecisionEscalationCandidate({
      state: stateAfterFirst,
      escalation: makeEscalation({ escalationId: "DE-002" }),
      timestamp: T1,
      eventId: "EVT-002",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.state.decisionEscalations).toHaveLength(1);
    expect(second.runlogEvent).toBeNull();
  });

  it("rejects an unknown related work unit reference", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordDecisionEscalationCandidate({
      state,
      escalation: makeEscalation({ relatedWorkUnitIds: ["WU999"] }),
      timestamp: T1,
      eventId: "EVT-001",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown related milestone reference", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordDecisionEscalationCandidate({
      state,
      escalation: makeEscalation({ relatedMilestoneIds: ["M999"] }),
      timestamp: T1,
      eventId: "EVT-001",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown evidence reference", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const result = buildRecordDecisionEscalationCandidate({
      state,
      escalation: makeEscalation({ evidenceIds: ["EVID-999"] }),
      timestamp: T1,
      eventId: "EVT-001",
    });
    expect(result.ok).toBe(false);
  });

  it("does not mutate the input state object (pure function)", () => {
    const state = stateWithGraph([makeWorkUnit()], [makeMilestone()]);
    const before = getDecisionEscalations(state);
    buildRecordDecisionEscalationCandidate({ state, escalation: makeEscalation(), timestamp: T1, eventId: "EVT-001" });
    expect(getDecisionEscalations(state)).toEqual(before);
    expect(getDecisionEscalations(state)).toHaveLength(0);
  });
});
