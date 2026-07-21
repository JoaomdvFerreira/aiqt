import { describe, it, expect } from "vitest";
import {
  EvidenceRecordSchema,
  ArtifactReferenceSchema,
  SourceFindingSchema,
  TrustLevelSchema,
  TRUST_LEVEL_ORDER,
  meetsTrustLevel,
  EVIDENCE_MAX_SOURCE_FINDINGS,
  EVIDENCE_MAX_ARTIFACT_REFERENCES,
  EVIDENCE_MAX_DECISION_ESCALATION_REFS,
  EVIDENCE_MAX_SERIALIZED_BYTES,
} from "../../src/schema/evidence.schema.js";
import { evaluateEvidenceBinding } from "../../src/services/evidence-binding-service.js";

const NOW = "2026-01-01T00:00:00.000Z";
const DIGEST = "a".repeat(64);

function makeEvidence(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    evidenceId: "EVID-001",
    contractVersion: "1.0",
    provider: { providerId: "reviewer-1", providerType: "human", trustLevel: "repository_local" },
    workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1" },
    codeBinding: { commitSha: "abc123", capturedAt: NOW },
    reviewer: { reviewerType: "human", independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "Looks good" },
    sourceFindings: [],
    decisionEscalationIds: [],
    artifactReferences: [],
    recordedAt: NOW,
    ...overrides,
  };
}

describe("Trust levels (M22-WU04 / spec §5.1)", () => {
  it("orders trust levels 0..3 as specified", () => {
    expect(TRUST_LEVEL_ORDER.unverified).toBe(0);
    expect(TRUST_LEVEL_ORDER.self_reported).toBe(1);
    expect(TRUST_LEVEL_ORDER.repository_local).toBe(2);
    expect(TRUST_LEVEL_ORDER.platform_verified).toBe(3);
  });

  it("meetsTrustLevel compares actual >= minimum", () => {
    expect(meetsTrustLevel("platform_verified", "repository_local")).toBe(true);
    expect(meetsTrustLevel("repository_local", "repository_local")).toBe(true);
    expect(meetsTrustLevel("self_reported", "repository_local")).toBe(false);
  });

  it("rejects an unknown trust level rather than silently downgrading", () => {
    expect(TrustLevelSchema.safeParse("mostly_trusted").success).toBe(false);
  });
});

describe("EvidenceRecordSchema (M22-WU04)", () => {
  it("accepts a minimal-but-complete valid record", () => {
    expect(EvidenceRecordSchema.safeParse(makeEvidence()).success).toBe(true);
  });

  it("accepts optional fields omitted (checkpointId, branch, reviewerId)", () => {
    const value = makeEvidence();
    expect(EvidenceRecordSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an invalid contractVersion shape", () => {
    expect(EvidenceRecordSchema.safeParse(makeEvidence({ contractVersion: "v1" })).success).toBe(false);
  });

  it("rejects an invalid providerType enum", () => {
    const value = makeEvidence({ provider: { providerId: "p", providerType: "robot", trustLevel: "unverified" } });
    expect(EvidenceRecordSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an empty results.summary", () => {
    const value = makeEvidence({
      results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "" },
    });
    expect(EvidenceRecordSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an empty workUnitId in workflowBinding", () => {
    const value = makeEvidence({
      workflowBinding: { workUnitId: "", packetId: "PKT-001", implementationRootId: "ROOT-1" },
    });
    expect(EvidenceRecordSchema.safeParse(value).success).toBe(false);
  });

  it("rejects sourceFindings beyond the cap", () => {
    const finding = {
      sourceFindingId: "SF-1",
      sourceFingerprint: "fp",
      title: "t",
      summary: "s",
      sourceSeverityClaim: "medium",
      sourceFixabilityClaim: "unknown",
      scopeClaim: "execution_local",
      relatedIds: [],
    };
    const tooMany = Array.from({ length: EVIDENCE_MAX_SOURCE_FINDINGS + 1 }, () => finding);
    expect(EvidenceRecordSchema.safeParse(makeEvidence({ sourceFindings: tooMany })).success).toBe(false);
  });

  it("rejects artifactReferences beyond the cap", () => {
    const ref = { artifactId: "A-1", kind: "log", locator: "s3://bucket/key" };
    const tooMany = Array.from({ length: EVIDENCE_MAX_ARTIFACT_REFERENCES + 1 }, () => ref);
    expect(EvidenceRecordSchema.safeParse(makeEvidence({ artifactReferences: tooMany })).success).toBe(false);
  });

  it("rejects decisionEscalationIds beyond the cap", () => {
    const tooMany = Array.from({ length: EVIDENCE_MAX_DECISION_ESCALATION_REFS + 1 }, (_, i) => `DE-${i}`);
    expect(EvidenceRecordSchema.safeParse(makeEvidence({ decisionEscalationIds: tooMany })).success).toBe(false);
  });

  it("rejects a record exceeding max_serialized_bytes (large inline payload rejected)", () => {
    const oversized = makeEvidence({
      results: {
        reviewResult: "passed",
        validationResult: "passed",
        acceptanceCriteriaResult: "passed",
        summary: "x".repeat(EVIDENCE_MAX_SERIALIZED_BYTES),
      },
    });
    expect(EvidenceRecordSchema.safeParse(oversized).success).toBe(false);
  });

  it("stores only a bounded summary, never an unbounded inline log", () => {
    // The schema has no "log"/"body"/"transcript" field at all -- evidence
    // can only reference artifacts (locator/digest), never embed them.
    const keys = Object.keys(EvidenceRecordSchema.parse(makeEvidence()));
    expect(keys).not.toContain("log");
    expect(keys).not.toContain("transcript");
    expect(keys).not.toContain("body");
  });
});

describe("ArtifactReferenceSchema (M22-WU04)", () => {
  it("accepts a minimal valid reference (locator only)", () => {
    expect(ArtifactReferenceSchema.safeParse({ artifactId: "A-1", kind: "log", locator: "path/to/log" }).success).toBe(true);
  });

  it("accepts a full reference with a valid sha256 digest", () => {
    const value = { artifactId: "A-1", kind: "ci_run", locator: "https://ci.example/run/1", digest: { algorithm: "sha256", value: DIGEST } };
    expect(ArtifactReferenceSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an invalid digest value shape", () => {
    const value = { artifactId: "A-1", kind: "log", locator: "x", digest: { algorithm: "sha256", value: "not-hex" } };
    expect(ArtifactReferenceSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an invalid kind enum", () => {
    expect(ArtifactReferenceSchema.safeParse({ artifactId: "A-1", kind: "video", locator: "x" }).success).toBe(false);
  });

  it("rejects an empty locator", () => {
    expect(ArtifactReferenceSchema.safeParse({ artifactId: "A-1", kind: "log", locator: "" }).success).toBe(false);
  });
});

describe("SourceFindingSchema (M22-WU04)", () => {
  function makeFinding(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      sourceFindingId: "SF-1",
      sourceFingerprint: "fp-1",
      title: "Title",
      summary: "Summary",
      sourceSeverityClaim: "high",
      sourceFixabilityClaim: "agent_fixable",
      scopeClaim: "work_unit",
      relatedIds: [],
      ...overrides,
    };
  }

  it("accepts a full valid finding", () => {
    expect(SourceFindingSchema.safeParse(makeFinding()).success).toBe(true);
  });

  it("rejects an invalid sourceSeverityClaim enum", () => {
    expect(SourceFindingSchema.safeParse(makeFinding({ sourceSeverityClaim: "urgent" })).success).toBe(false);
  });

  it("rejects an invalid scopeClaim enum", () => {
    expect(SourceFindingSchema.safeParse(makeFinding({ scopeClaim: "everywhere" })).success).toBe(false);
  });

  it("rejects an invalid evidenceTextDigest shape when present", () => {
    expect(SourceFindingSchema.safeParse(makeFinding({ evidenceTextDigest: "not-a-digest" })).success).toBe(false);
  });

  it("accepts a valid evidenceTextDigest", () => {
    expect(SourceFindingSchema.safeParse(makeFinding({ evidenceTextDigest: DIGEST })).success).toBe(true);
  });
});

describe("evaluateEvidenceBinding (M22-WU04 / spec §5.8)", () => {
  const evidence = EvidenceRecordSchema.parse(
    makeEvidence({ codeBinding: { commitSha: "abc123", repositoryFingerprint: "fp-repo", capturedAt: NOW } }),
  );

  it("returns current when all available binding values match", () => {
    const result = evaluateEvidenceBinding(evidence, {
      workUnitId: "WU001",
      packetId: "PKT-001",
      implementationRootId: "ROOT-1",
      commitSha: "abc123",
      repositoryFingerprint: "fp-repo",
      inspectable: true,
    });
    expect(result).toBe("current");
  });

  it("returns mismatched for a wrong work unit", () => {
    const result = evaluateEvidenceBinding(evidence, {
      workUnitId: "WU999",
      packetId: "PKT-001",
      implementationRootId: "ROOT-1",
      commitSha: "abc123",
      inspectable: true,
    });
    expect(result).toBe("mismatched");
  });

  it("returns mismatched for a wrong packet", () => {
    const result = evaluateEvidenceBinding(evidence, {
      workUnitId: "WU001",
      packetId: "PKT-999",
      implementationRootId: "ROOT-1",
      commitSha: "abc123",
      inspectable: true,
    });
    expect(result).toBe("mismatched");
  });

  it("returns mismatched for a wrong implementation root", () => {
    const result = evaluateEvidenceBinding(evidence, {
      workUnitId: "WU001",
      packetId: "PKT-001",
      implementationRootId: "ROOT-999",
      commitSha: "abc123",
      inspectable: true,
    });
    expect(result).toBe("mismatched");
  });

  it("returns stale when the known commit sha changed after capture", () => {
    const result = evaluateEvidenceBinding(evidence, {
      workUnitId: "WU001",
      packetId: "PKT-001",
      implementationRootId: "ROOT-1",
      commitSha: "def456",
      inspectable: true,
    });
    expect(result).toBe("stale");
  });

  it("returns unavailable when required local repository state cannot be inspected", () => {
    const result = evaluateEvidenceBinding(evidence, {
      workUnitId: "WU001",
      packetId: "PKT-001",
      implementationRootId: "ROOT-1",
      inspectable: false,
    });
    expect(result).toBe("unavailable");
  });

  it("returns unknown when there is insufficient binding data on either side", () => {
    const noCodeBinding = EvidenceRecordSchema.parse(makeEvidence({ codeBinding: { capturedAt: NOW } }));
    const result = evaluateEvidenceBinding(noCodeBinding, {
      workUnitId: "WU001",
      packetId: "PKT-001",
      implementationRootId: "ROOT-1",
      inspectable: true,
    });
    expect(result).toBe("unknown");
  });

  it("is deterministic across repeated evaluation of the same inputs", () => {
    const facts = {
      workUnitId: "WU001",
      packetId: "PKT-001",
      implementationRootId: "ROOT-1",
      commitSha: "abc123",
      inspectable: true,
    };
    const first = evaluateEvidenceBinding(evidence, facts);
    const second = evaluateEvidenceBinding(evidence, facts);
    expect(first).toBe(second);
  });
});
