import { describe, it, expect } from "vitest";
import { buildEvidenceSnapshotEntries } from "../../src/workflow/evidence-gate-snapshot.js";
import { simulate, evaluateRule, aggregateOverallResult } from "../../src/workflow/evidence-gate-simulation-engine.js";
import { computeEvidenceSnapshotDigest } from "../../src/workflow/evidence-gate-digest.js";
import type { EvidenceRecord } from "../../src/schema/evidence.schema.js";
import type { EvidenceGatePolicy, EvidenceGateRule } from "../../src/schema/evidence-gate-policy.schema.js";
import type { SimulationTarget } from "../../src/schema/evidence-gate-simulation.schema.js";

const PROJECT_ID = "PROJECT-001";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z"; // 1 day later

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: "EVD-001",
    contractVersion: "1.0",
    provider: { providerId: "human", providerType: "human", trustLevel: "repository_local" },
    workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-001" },
    codeBinding: { capturedAt: T1 },
    reviewer: { reviewerType: "human", independentContext: "unknown" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    sourceFindings: [],
    decisionEscalationIds: [],
    artifactReferences: [{ artifactId: "ART-1", kind: "test_result", locator: "https://example.test/1" }],
    recordedAt: T1,
    ...overrides,
  };
}

function makeRule(overrides: Partial<EvidenceGateRule> = {}): EvidenceGateRule {
  return {
    ruleId: "r1",
    title: "Rule 1",
    appliesTo: ["project", "work_unit", "checkpoint"],
    evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" },
    requirement: { minimumCount: 1 },
    missingDisposition: "fail",
    ...overrides,
  };
}

function makePolicy(rules: EvidenceGateRule[]): EvidenceGatePolicy {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "p1",
    version: 1,
    name: "P1",
    targetScopes: ["project", "work_unit", "checkpoint"],
    rules,
    policyDigest: "sha256:" + "a".repeat(64),
    createdAt: T1,
  };
}

const WORK_UNIT_TARGET: SimulationTarget = { type: "work_unit", id: "WU001", relatedProjectId: PROJECT_ID };
const PROJECT_TARGET: SimulationTarget = { type: "project", id: PROJECT_ID, relatedProjectId: PROJECT_ID };
const CHECKPOINT_TARGET: SimulationTarget = { type: "checkpoint", id: "CKPT-001", relatedProjectId: PROJECT_ID, relatedWorkUnitId: "WU001" };

describe("M28-WU03: evidence snapshot construction", () => {
  it("normalizes scope refs, artifact kinds, and freshness timestamp", () => {
    const record = makeRecord({ workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: "CKPT-001", implementationRootId: "ROOT-001" } });
    const [entry] = buildEvidenceSnapshotEntries([record], PROJECT_ID);
    expect(entry.scopeRefs).toEqual(["checkpoint:CKPT-001", "project:PROJECT-001", "work_unit:WU001"]);
    expect(entry.artifactKinds).toEqual(["test_result"]);
    expect(entry.trust).toBe("repository_local");
    expect(entry.freshnessTimestamp).toBe(T1);
    expect(entry.referenceValidity).toBe("valid");
  });

  it("marks a record with zero artifact references as invalid", () => {
    const record = makeRecord({ artifactReferences: [] });
    const [entry] = buildEvidenceSnapshotEntries([record], PROJECT_ID);
    expect(entry.referenceValidity).toBe("invalid");
  });

  it("rejects duplicate evidenceIds as invalid canonical state", () => {
    const a = makeRecord({ evidenceId: "EVD-001" });
    const b = makeRecord({ evidenceId: "EVD-001" });
    expect(() => buildEvidenceSnapshotEntries([a, b], PROJECT_ID)).toThrow(/Duplicate evidenceId/);
  });

  it("entries are sorted lexicographically by evidenceId regardless of insertion order", () => {
    const a = makeRecord({ evidenceId: "EVD-002" });
    const b = makeRecord({ evidenceId: "EVD-001" });
    const forward = buildEvidenceSnapshotEntries([a, b], PROJECT_ID);
    const reverse = buildEvidenceSnapshotEntries([b, a], PROJECT_ID);
    expect(forward.map((e) => e.evidenceId)).toEqual(["EVD-001", "EVD-002"]);
    expect(reverse.map((e) => e.evidenceId)).toEqual(["EVD-001", "EVD-002"]);
  });

  it("produces an identical evidenceSnapshotDigest regardless of insertion order", () => {
    const a = makeRecord({ evidenceId: "EVD-002" });
    const b = makeRecord({ evidenceId: "EVD-001" });
    const digestForward = computeEvidenceSnapshotDigest(PROJECT_TARGET, buildEvidenceSnapshotEntries([a, b], PROJECT_ID));
    const digestReverse = computeEvidenceSnapshotDigest(PROJECT_TARGET, buildEvidenceSnapshotEntries([b, a], PROJECT_ID));
    expect(digestForward).toBe(digestReverse);
    expect(digestForward).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("M28-WU03: rule evaluation outcomes (§5.3)", () => {
  it("pass when matchedCount >= minimumCount", () => {
    const entries = buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID);
    const result = evaluateRule(makeRule(), WORK_UNIT_TARGET, entries, T1);
    expect(result.result).toBe("pass");
    expect(result.reasonCode).toBe("sufficient_evidence");
    expect(result.matchedCount).toBe(1);
  });

  it("fail when missingDisposition is fail and evidence is insufficient", () => {
    const entries = buildEvidenceSnapshotEntries([], PROJECT_ID);
    const result = evaluateRule(makeRule({ missingDisposition: "fail" }), WORK_UNIT_TARGET, entries, T1);
    expect(result.result).toBe("fail");
    expect(result.reasonCode).toBe("insufficient_evidence");
  });

  it("indeterminate when missingDisposition is indeterminate and evidence is insufficient", () => {
    const entries = buildEvidenceSnapshotEntries([], PROJECT_ID);
    const result = evaluateRule(makeRule({ missingDisposition: "indeterminate" }), WORK_UNIT_TARGET, entries, T1);
    expect(result.result).toBe("indeterminate");
    expect(result.reasonCode).toBe("insufficient_evidence_indeterminate");
  });

  it("not_applicable when the target type is not in appliesTo, and never inspects evidence", () => {
    const entries = buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID);
    const result = evaluateRule(makeRule({ appliesTo: ["checkpoint"] }), WORK_UNIT_TARGET, entries, T1);
    expect(result.result).toBe("not_applicable");
    expect(result.reasonCode).toBe("target_not_applicable");
    expect(result.matchedCount).toBe(0);
    expect(result.rejectedCandidateCounts).toEqual({ wrongArtifactKind: 0, insufficientTrust: 0, wrongScope: 0, stale: 0, invalidReference: 0 });
  });

  it("zero applicable rules produces overall indeterminate", () => {
    expect(aggregateOverallResult([])).toBe("indeterminate");
    const notApplicable = evaluateRule(makeRule({ appliesTo: ["checkpoint"] }), WORK_UNIT_TARGET, [], T1);
    expect(aggregateOverallResult([notApplicable])).toBe("indeterminate");
  });

  it("overall aggregation: any fail wins over indeterminate and pass", () => {
    const pass = evaluateRule(makeRule({ ruleId: "pass-rule" }), WORK_UNIT_TARGET, buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID), T1);
    const fail = evaluateRule(makeRule({ ruleId: "fail-rule" }), WORK_UNIT_TARGET, [], T1);
    expect(aggregateOverallResult([pass, fail])).toBe("fail");
  });

  it("overall aggregation: indeterminate wins over pass when no fail exists", () => {
    const pass = evaluateRule(makeRule({ ruleId: "pass-rule" }), WORK_UNIT_TARGET, buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID), T1);
    const indeterminate = evaluateRule(makeRule({ ruleId: "ind-rule", missingDisposition: "indeterminate" }), WORK_UNIT_TARGET, [], T1);
    expect(aggregateOverallResult([pass, indeterminate])).toBe("indeterminate");
  });

  it("overall pass only when every applicable rule passes", () => {
    const pass1 = evaluateRule(makeRule({ ruleId: "r1" }), WORK_UNIT_TARGET, buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID), T1);
    const pass2 = evaluateRule(makeRule({ ruleId: "r2" }), WORK_UNIT_TARGET, buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID), T1);
    expect(aggregateOverallResult([pass1, pass2])).toBe("pass");
  });
});

describe("M28-WU03: trust ordering (§5.4)", () => {
  it("rejects evidence below the minimum trust threshold, using the canonical ordinal order", () => {
    const record = makeRecord({ provider: { providerId: "human", providerType: "human", trustLevel: "self_reported" } });
    const entries = buildEvidenceSnapshotEntries([record], PROJECT_ID);
    const result = evaluateRule(makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" } }), WORK_UNIT_TARGET, entries, T1);
    expect(result.matchedCount).toBe(0);
    expect(result.rejectedCandidateCounts.insufficientTrust).toBe(1);
  });

  it("accepts evidence at or above the minimum trust threshold", () => {
    const record = makeRecord({ provider: { providerId: "human", providerType: "human", trustLevel: "platform_verified" } });
    const entries = buildEvidenceSnapshotEntries([record], PROJECT_ID);
    const result = evaluateRule(makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" } }), WORK_UNIT_TARGET, entries, T1);
    expect(result.matchedCount).toBe(1);
  });
});

describe("M28-WU03: artifact-kind matching", () => {
  it("wrongArtifactKind is counted when no valid reference has a selected kind", () => {
    const record = makeRecord({ artifactReferences: [{ artifactId: "A", kind: "screenshot", locator: "x" }] });
    const entries = buildEvidenceSnapshotEntries([record], PROJECT_ID);
    const result = evaluateRule(makeRule(), WORK_UNIT_TARGET, entries, T1);
    expect(result.rejectedCandidateCounts.wrongArtifactKind).toBe(1);
  });

  it("a record with multiple matching artifacts counts once within one rule", () => {
    const record = makeRecord({
      artifactReferences: [
        { artifactId: "A", kind: "test_result", locator: "x" },
        { artifactId: "B", kind: "test_result", locator: "y" },
        { artifactId: "C", kind: "ci_run", locator: "z" },
      ],
    });
    const entries = buildEvidenceSnapshotEntries([record], PROJECT_ID);
    const result = evaluateRule(makeRule({ evidenceSelector: { artifactKinds: ["test_result", "ci_run"], minimumTrust: "unverified", scopeMatch: "exact_target" } }), WORK_UNIT_TARGET, entries, T1);
    expect(result.matchedCount).toBe(1);
    expect(result.matchedEvidenceRefs).toEqual(["EVD-001"]);
  });
});

describe("M28-WU03: scope matching (§5.5)", () => {
  it("project target: project evidence counts (both modes are equivalent at project scope)", () => {
    const entries = buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID);
    const exact = evaluateRule(makeRule({ evidenceSelector: { ...makeRule().evidenceSelector, scopeMatch: "exact_target" } }), PROJECT_TARGET, entries, T1);
    const inherited = evaluateRule(makeRule({ evidenceSelector: { ...makeRule().evidenceSelector, scopeMatch: "target_or_project" } }), PROJECT_TARGET, entries, T1);
    expect(exact.matchedCount).toBe(1);
    expect(inherited.matchedCount).toBe(1);
  });

  it("work_unit target, exact_target: only that exact work unit's evidence matches, not a sibling work unit's", () => {
    const own = makeRecord({ evidenceId: "EVD-OWN", workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-001" } });
    const sibling = makeRecord({ evidenceId: "EVD-SIBLING", workflowBinding: { workUnitId: "WU002", packetId: "PKT-002", implementationRootId: "ROOT-001" } });
    const entries = buildEvidenceSnapshotEntries([own, sibling], PROJECT_ID);
    const result = evaluateRule(makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "unverified", scopeMatch: "exact_target" } }), WORK_UNIT_TARGET, entries, T1);
    expect(result.matchedEvidenceRefs).toEqual(["EVD-OWN"]);
    expect(result.rejectedCandidateCounts.wrongScope).toBe(1);
  });

  it("checkpoint target, exact_target: only that exact checkpoint's evidence matches, not its own work unit's", () => {
    const checkpointEvidence = makeRecord({
      evidenceId: "EVD-CKPT",
      workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: "CKPT-001", implementationRootId: "ROOT-001" },
    });
    const wuOnlyEvidence = makeRecord({ evidenceId: "EVD-WU-ONLY", workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-001" } });
    const entries = buildEvidenceSnapshotEntries([checkpointEvidence, wuOnlyEvidence], PROJECT_ID);
    const result = evaluateRule(
      makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "unverified", scopeMatch: "exact_target" } }),
      CHECKPOINT_TARGET,
      entries,
      T1,
    );
    expect(result.matchedEvidenceRefs).toEqual(["EVD-CKPT"]);
  });

  it("checkpoint target, target_or_project: also matches the checkpoint's own related work unit's evidence via the explicit Checkpoint.workUnitId relationship (and, since every record carries a universal project scope-ref, project evidence generally)", () => {
    const checkpointEvidence = makeRecord({
      evidenceId: "EVD-CKPT",
      workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: "CKPT-001", implementationRootId: "ROOT-001" },
    });
    const wuEvidence = makeRecord({ evidenceId: "EVD-WU", workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-001" } });
    const entries = buildEvidenceSnapshotEntries([checkpointEvidence, wuEvidence], PROJECT_ID);
    const result = evaluateRule(
      makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "unverified", scopeMatch: "target_or_project" } }),
      CHECKPOINT_TARGET,
      entries,
      T1,
    );
    expect(result.matchedEvidenceRefs).toEqual(["EVD-CKPT", "EVD-WU"]);
  });
});

describe("M28-WU03: freshness (§5.6)", () => {
  it("no maxAgeSeconds means freshness is never checked", () => {
    const entries = buildEvidenceSnapshotEntries([makeRecord({ recordedAt: T1 })], PROJECT_ID);
    const result = evaluateRule(makeRule(), WORK_UNIT_TARGET, entries, T2);
    expect(result.matchedCount).toBe(1);
  });

  it("stale evidence beyond maxAgeSeconds is rejected", () => {
    const entries = buildEvidenceSnapshotEntries([makeRecord({ recordedAt: T1 })], PROJECT_ID);
    const rule = makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "unverified", scopeMatch: "exact_target", maxAgeSeconds: 3600 } });
    const result = evaluateRule(rule, WORK_UNIT_TARGET, entries, T2); // one day later, 3600s max
    expect(result.matchedCount).toBe(0);
    expect(result.rejectedCandidateCounts.stale).toBe(1);
  });

  it("fresh evidence within maxAgeSeconds is accepted", () => {
    const entries = buildEvidenceSnapshotEntries([makeRecord({ recordedAt: T1 })], PROJECT_ID);
    const rule = makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "unverified", scopeMatch: "exact_target", maxAgeSeconds: 172800 } }); // 2 days
    const result = evaluateRule(rule, WORK_UNIT_TARGET, entries, T2);
    expect(result.matchedCount).toBe(1);
  });

  it("future-dated evidence never satisfies freshness", () => {
    const entries = buildEvidenceSnapshotEntries([makeRecord({ recordedAt: T2 })], PROJECT_ID); // recorded "in the future" relative to asOf=T1
    const rule = makeRule({ evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "unverified", scopeMatch: "exact_target", maxAgeSeconds: 31536000 } });
    const result = evaluateRule(rule, WORK_UNIT_TARGET, entries, T1);
    expect(result.matchedCount).toBe(0);
    expect(result.rejectedCandidateCounts.stale).toBe(1);
  });
});

describe("M28-WU03: full simulate() determinism across insertion order", () => {
  it("identical logical inputs produce identical simulationDigest regardless of evidence-record insertion order", () => {
    const policy = makePolicy([makeRule()]);
    const a = makeRecord({ evidenceId: "EVD-002" });
    const b = makeRecord({ evidenceId: "EVD-001" });

    const simForward = simulate({ policy, target: WORK_UNIT_TARGET, entries: buildEvidenceSnapshotEntries([a, b], PROJECT_ID), asOf: T1, generatedAt: T2 });
    const simReverse = simulate({ policy, target: WORK_UNIT_TARGET, entries: buildEvidenceSnapshotEntries([b, a], PROJECT_ID), asOf: T1, generatedAt: "2026-06-01T00:00:00.000Z" });

    expect(simForward.simulationDigest).toBe(simReverse.simulationDigest);
    expect(simForward.evidenceSnapshotDigest).toBe(simReverse.evidenceSnapshotDigest);
    // generatedAt differs but must not affect the digest.
    expect(simForward.generatedAt).not.toBe(simReverse.generatedAt);
  });

  it("every simulation is read-only: calling simulate() twice never mutates its inputs", () => {
    const policy = makePolicy([makeRule()]);
    const entries = buildEvidenceSnapshotEntries([makeRecord()], PROJECT_ID);
    const entriesCopy = JSON.parse(JSON.stringify(entries));
    simulate({ policy, target: WORK_UNIT_TARGET, entries, asOf: T1, generatedAt: T1 });
    expect(entries).toEqual(entriesCopy);
  });
});
