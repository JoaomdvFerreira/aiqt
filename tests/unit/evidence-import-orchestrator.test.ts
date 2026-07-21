import { describe, it, expect } from "vitest";
import {
  buildEvidenceImportCandidate,
  evaluateImportBindingDecision,
  resolveImportConflict,
} from "../../src/evidence/import-orchestrator.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Checkpoint, CheckpointIssue } from "../../src/schema/checkpoint.schema.js";
import type { EvidenceRecord } from "../../src/schema/evidence.schema.js";
import type { NormalizedEvidenceCandidate } from "../../src/schema/external-evidence/normalized-evidence-candidate.js";

const T1 = "2026-01-01T00:00:00.000Z";
const DIGEST_A = "sha256:" + "a".repeat(64);
const DIGEST_B = "sha256:" + "b".repeat(64);

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

function checkpointIssue(overrides: Partial<CheckpointIssue> = {}): CheckpointIssue {
  return { title: "Some issue", description: null, severity: "high", status: "open", agentCanFix: true, ...overrides };
}

function checkpoint(id: string, workUnitId: string, issues: CheckpointIssue[]): Checkpoint {
  return {
    id,
    workUnitId,
    packetId: null,
    summary: "s",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    issues,
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "done",
    nextRecommendation: "aiqt next",
    createdAt: T1,
  };
}

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  const state = buildInitialStateModel(T1);
  return {
    ...state,
    workGraph: { milestones: [makeMilestone()], workUnits: [makeWorkUnit()], dependencies: [] },
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<NormalizedEvidenceCandidate> = {}): NormalizedEvidenceCandidate {
  return {
    adapterId: "generic-evidence-json@1",
    sourcePayloadDigest: DIGEST_A,
    externalEvidenceId: null,
    provider: { providerId: "prov-1", providerType: "agent", trustLevel: "unverified" },
    workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: null, implementationRootId: "ROOT-1" },
    codeBinding: { commitSha: "abc123", capturedAt: T1 },
    reviewer: { reviewerType: "agent", independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    sourceFindings: [],
    artifactReferences: [],
    decisionEscalationCandidates: [],
    capturedAt: T1,
    ...overrides,
  };
}

function eventIdSequence(prefix = "EVT"): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(3, "0")}`;
}

describe("evaluateImportBindingDecision (M23 §14)", () => {
  it("accepts 'current' with no warning", () => {
    expect(evaluateImportBindingDecision("current")).toEqual({ accepted: true, warning: null });
  });
  it.each(["stale", "unavailable", "unknown"] as const)("accepts '%s' with a warning", (status) => {
    const result = evaluateImportBindingDecision(status);
    expect(result.accepted).toBe(true);
    if (result.accepted) expect(result.warning).not.toBeNull();
  });
  it("rejects 'mismatched'", () => {
    const result = evaluateImportBindingDecision("mismatched");
    expect(result.accepted).toBe(false);
  });
});

describe("resolveImportConflict (M23 §9 conflict matrix)", () => {
  function evidenceWithProvenance(evidenceId: string, importIdentityKey: string, digest: string): EvidenceRecord {
    return {
      evidenceId,
      contractVersion: "1.0",
      provider: { providerId: "p", providerType: "agent", trustLevel: "unverified" },
      workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1" },
      codeBinding: { capturedAt: T1 },
      reviewer: { reviewerType: "agent", independentContext: "declared_independent" },
      results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
      sourceFindings: [],
      decisionEscalationIds: [],
      artifactReferences: [],
      recordedAt: T1,
      importProvenance: { adapterId: "a", sourcePayloadDigest: digest, importIdentityKey, importedAt: T1 },
    };
  }

  it("creates when no existing record shares the importIdentityKey", () => {
    expect(resolveImportConflict("key-1", DIGEST_A, [])).toEqual({ outcome: "create" });
  });

  it("no-ops (links) when the same key and the same digest already exist", () => {
    const existing = evidenceWithProvenance("EVID-001", "key-1", DIGEST_A);
    expect(resolveImportConflict("key-1", DIGEST_A, [existing])).toEqual({
      outcome: "no_op",
      existingEvidenceId: "EVID-001",
    });
  });

  it("conflicts when the same key resolves to a different digest, never overwriting", () => {
    const existing = evidenceWithProvenance("EVID-001", "key-1", DIGEST_A);
    const result = resolveImportConflict("key-1", DIGEST_B, [existing]);
    expect(result.outcome).toBe("conflict");
    expect(result.existingEvidenceId).toBe("EVID-001");
  });
});

describe("buildEvidenceImportCandidate (WU23-06 full pipeline)", () => {
  it("rejects a mismatched binding with zero mutation", () => {
    const state = baseState();
    const result = buildEvidenceImportCandidate({
      state,
      candidate: makeCandidate(),
      importIdentityKey: "key-1",
      bindingStatus: "mismatched",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(result.ok).toBe(false);
  });

  it("creates a new EvidenceRecord with importProvenance, and carries a stale-binding warning", () => {
    const state = baseState();
    const result = buildEvidenceImportCandidate({
      state,
      candidate: makeCandidate(),
      importIdentityKey: "key-1",
      bindingStatus: "stale",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("created");
    expect(result.evidenceRecord.evidenceId).toBe("EVID-001");
    expect(result.evidenceRecord.importProvenance?.importIdentityKey).toBe("key-1");
    expect(result.warnings).toHaveLength(1);
    expect(result.runlogEvents.some((e) => e.type === "evidence.recorded")).toBe(true);
  });

  it("no-ops on a replayed importIdentityKey with the same digest -- zero new records, zero runlog events", () => {
    const state = baseState();
    const first = buildEvidenceImportCandidate({
      state,
      candidate: makeCandidate(),
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(first.ok && first.changed).toBe(true);
    if (!first.ok) return;
    const stateAfterFirst: StateModel = { ...state, evidence: { records: [first.evidenceRecord], decisionEscalations: [] } };

    const second = buildEvidenceImportCandidate({
      state: stateAfterFirst,
      candidate: makeCandidate(),
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.outcome).toBe("no_op");
    expect(second.evidenceRecord.evidenceId).toBe(first.evidenceRecord.evidenceId);
    expect(second.runlogEvents).toEqual([]);
  });

  it("rejects a replayed importIdentityKey with a different digest -- conflict, zero mutation", () => {
    const state = baseState();
    const first = buildEvidenceImportCandidate({
      state,
      candidate: makeCandidate({ sourcePayloadDigest: DIGEST_A }),
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stateAfterFirst: StateModel = { ...state, evidence: { records: [first.evidenceRecord], decisionEscalations: [] } };

    const second = buildEvidenceImportCandidate({
      state: stateAfterFirst,
      candidate: makeCandidate({ sourcePayloadDigest: DIGEST_B }),
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(second.ok).toBe(false);
  });

  it("creates a new ProjectIssue (sourceType=evidence, fixed medium severity) for a finding with no checkpoint match", () => {
    const state = baseState();
    const candidate = makeCandidate({
      sourceFindings: [
        {
          sourceFindingId: "F1",
          sourceFingerprint: "fp",
          title: "Something broke",
          summary: "s",
          sourceSeverityClaim: "critical",
          sourceFixabilityClaim: "unknown",
          scopeClaim: "project",
          relatedIds: [],
        },
      ],
    });
    const result = buildEvidenceImportCandidate({
      state,
      candidate,
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdProjectIssues).toHaveLength(1);
    expect(result.createdProjectIssues[0].sourceType).toBe("evidence");
    // canonical severity is never derived from the untrusted severity claim
    expect(result.createdProjectIssues[0].severity).toBe("medium");
    expect(result.runlogEvents.some((e) => e.type === "project_issue.created")).toBe(true);
  });

  it("links to an existing ProjectIssue for a repeated finding instead of creating a duplicate", () => {
    const state = baseState();
    const candidate = makeCandidate({
      sourceFindings: [
        {
          sourceFindingId: "F1",
          sourceFingerprint: "fp",
          title: "Recurring problem",
          summary: "s",
          sourceSeverityClaim: "unknown",
          sourceFixabilityClaim: "unknown",
          scopeClaim: "project",
          relatedIds: [],
        },
      ],
    });
    const first = buildEvidenceImportCandidate({
      state,
      candidate,
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const stateAfterFirst: StateModel = {
      ...state,
      evidence: { records: [first.evidenceRecord], decisionEscalations: [] },
      issues: { overrides: [], promotions: [], projectIssues: first.createdProjectIssues, projectIssueTransitions: [] },
    };

    const second = buildEvidenceImportCandidate({
      state: stateAfterFirst,
      candidate: makeCandidate({
        sourcePayloadDigest: DIGEST_B,
        sourceFindings: candidate.sourceFindings,
      }),
      importIdentityKey: "key-2",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.createdProjectIssues).toHaveLength(0);
    expect(second.linkedProjectIssueKeys).toHaveLength(1);
  });

  it("promotes a matching open CheckpointIssue into a ProjectIssue via the M22 transition owner, using the checkpoint's own severity", () => {
    const state = baseState({
      checkpoints: [checkpoint("CP001", "WU001", [checkpointIssue({ title: "Timeout under load", severity: "high" })])],
    });
    const candidate = makeCandidate({
      sourceFindings: [
        {
          sourceFindingId: "F1",
          sourceFingerprint: "fp",
          title: "Timeout under load",
          summary: "s",
          sourceSeverityClaim: "low",
          sourceFixabilityClaim: "unknown",
          scopeClaim: "execution_local",
          relatedIds: [],
        },
      ],
    });
    const result = buildEvidenceImportCandidate({
      state,
      candidate,
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdProjectIssues).toHaveLength(1);
    expect(result.createdProjectIssues[0].sourceType).toBe("checkpoint");
    // uses the checkpoint issue's own severity, not the untrusted claim
    expect(result.createdProjectIssues[0].severity).toBe("high");
    expect(result.projectIssueTransitions).toHaveLength(1);
    expect(result.runlogEvents.some((e) => e.type === "project_issue.transitioned")).toBe(true);
  });

  it("creates a decision escalation candidate and includes its ID on the evidence record", () => {
    const state = baseState();
    const candidate = makeCandidate({
      decisionEscalationCandidates: [
        { localId: "E1", category: "security", question: "Is this safe?", rationale: "r" },
      ],
    });
    const result = buildEvidenceImportCandidate({
      state,
      candidate,
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdDecisionEscalations).toHaveLength(1);
    expect(result.evidenceRecord.decisionEscalationIds).toEqual([result.createdDecisionEscalations[0].escalationId]);
    expect(result.runlogEvents.some((e) => e.type === "decision_escalation.created")).toBe(true);
  });

  it("links a repeated decision escalation (same category+question) instead of duplicating it", () => {
    const state = baseState();
    const candidate = makeCandidate({
      decisionEscalationCandidates: [
        { localId: "E1", category: "security", question: "Is this safe?", rationale: "r" },
      ],
    });
    const first = buildEvidenceImportCandidate({
      state,
      candidate,
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stateAfterFirst: StateModel = {
      ...state,
      evidence: { records: [first.evidenceRecord], decisionEscalations: first.createdDecisionEscalations },
    };

    const second = buildEvidenceImportCandidate({
      state: stateAfterFirst,
      candidate: makeCandidate({ sourcePayloadDigest: DIGEST_B, decisionEscalationCandidates: candidate.decisionEscalationCandidates }),
      importIdentityKey: "key-2",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: [],
      nextEventId: eventIdSequence(),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.createdDecisionEscalations).toHaveLength(0);
    expect(second.linkedDecisionEscalationIds).toEqual([first.createdDecisionEscalations[0].escalationId]);
  });

  it("propagates adapter warnings through to the result", () => {
    const state = baseState();
    const result = buildEvidenceImportCandidate({
      state,
      candidate: makeCandidate(),
      importIdentityKey: "key-1",
      bindingStatus: "current",
      timestamp: T1,
      adapterWarnings: ["adapter-level warning"],
      nextEventId: eventIdSequence(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain("adapter-level warning");
  });
});
