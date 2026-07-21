import { describe, it, expect } from "vitest";
import { GenericEvidenceV1Schema } from "../../src/schema/external-evidence/generic-evidence-v1.schema.js";
import { GenericCiV1Schema } from "../../src/schema/external-evidence/generic-ci-v1.schema.js";
import { ManualEvidenceV1Schema } from "../../src/schema/external-evidence/manual-evidence-v1.schema.js";
import { BOUNDED_SHORT_STRING_MAX, EXTERNAL_EVIDENCE_MAX_FINDINGS, EXTERNAL_EVIDENCE_MAX_ARTIFACTS } from "../../src/schema/external-evidence/limits.js";
import {
  SUPPORTED_EXTERNAL_EVIDENCE_FORMATS,
  EXTERNAL_EVIDENCE_SCHEMA_REGISTRY,
  isSupportedExternalEvidenceFormat,
  getExternalEvidenceSchema,
} from "../../src/evidence/adapter-registry.js";

const NOW = "2026-01-01T00:00:00.000Z";

function minimalGenericEvidence(overrides: Record<string, unknown> = {}) {
  return {
    format: "generic-evidence-json@1",
    source: { providerId: "prov-1", providerType: "agent" },
    binding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1", capturedAt: NOW },
    reviewer: { reviewerType: "agent", independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    ...overrides,
  };
}

function fullGenericEvidence() {
  return minimalGenericEvidence({
    externalId: "ext-1",
    binding: {
      workUnitId: "WU001",
      packetId: "PKT-001",
      checkpointId: "CKPT-1",
      implementationRootId: "ROOT-1",
      branch: "main",
      commitSha: "abc123",
      repositoryFingerprint: "fp-1",
      workingTreeFingerprint: "wtf-1",
      capturedAt: NOW,
    },
    reviewer: { reviewerId: "rev-1", reviewerType: "agent", independentContext: "declared_independent" },
    findings: [{ findingId: "F1", title: "t", summary: "s", severityClaim: "high", fixabilityClaim: "agent_fixable", scopeClaim: "work_unit", relatedIds: ["x"] }],
    artifacts: [{ artifactId: "A1", kind: "log", locator: "path/to/log.txt", digestAlgorithm: "sha256", digestValue: "a".repeat(64), mediaType: "text/plain", description: "d" }],
    decisionEscalations: [{ escalationLocalId: "E1", category: "architecture", question: "q", rationale: "r", proposedAnswer: "a" }],
  });
}

function minimalGenericCi(overrides: Record<string, unknown> = {}) {
  return {
    format: "generic-ci-json@1",
    source: { providerId: "prov-ci" },
    binding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1", commitSha: "abc123" },
    run: { status: "passed", completedAt: NOW, summary: "ok" },
    checks: [],
    ...overrides,
  };
}

function minimalManualEvidence(overrides: Record<string, unknown> = {}) {
  return {
    format: "manual-evidence-json@1",
    source: { providerId: "prov-manual" },
    binding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1", capturedAt: NOW },
    reviewer: { independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    ...overrides,
  };
}

describe("adapter registry (WU23-01)", () => {
  it("contains exactly the three specified formats, statically", () => {
    expect([...SUPPORTED_EXTERNAL_EVIDENCE_FORMATS].sort()).toEqual(
      ["generic-ci-json@1", "generic-evidence-json@1", "manual-evidence-json@1"].sort(),
    );
    expect(Object.keys(EXTERNAL_EVIDENCE_SCHEMA_REGISTRY).sort()).toEqual(
      [...SUPPORTED_EXTERNAL_EVIDENCE_FORMATS].sort(),
    );
  });

  it("isSupportedExternalEvidenceFormat rejects unknown/unsupported formats", () => {
    expect(isSupportedExternalEvidenceFormat("generic-evidence-json@1")).toBe(true);
    expect(isSupportedExternalEvidenceFormat("generic-evidence-json@2")).toBe(false);
    expect(isSupportedExternalEvidenceFormat("some-other-format")).toBe(false);
    expect(isSupportedExternalEvidenceFormat(123)).toBe(false);
  });

  it("getExternalEvidenceSchema resolves the correct schema per format", () => {
    expect(getExternalEvidenceSchema("generic-evidence-json@1")).toBe(GenericEvidenceV1Schema);
    expect(getExternalEvidenceSchema("generic-ci-json@1")).toBe(GenericCiV1Schema);
    expect(getExternalEvidenceSchema("manual-evidence-json@1")).toBe(ManualEvidenceV1Schema);
  });
});

describe.each([
  ["generic-evidence-json@1", GenericEvidenceV1Schema, minimalGenericEvidence, fullGenericEvidence] as const,
  ["generic-ci-json@1", GenericCiV1Schema, minimalGenericCi, minimalGenericCi] as const,
  ["manual-evidence-json@1", ManualEvidenceV1Schema, minimalManualEvidence, minimalManualEvidence] as const,
])("%s schema", (format, schema, minimal, full) => {
  it("accepts a minimal valid payload", () => {
    expect(schema.safeParse(minimal()).success).toBe(true);
  });

  it("accepts a full valid payload with optionals populated", () => {
    expect(schema.safeParse(full()).success).toBe(true);
  });

  it("rejects an incorrect format literal", () => {
    const result = schema.safeParse(minimal({ format: "wrong-format@1" }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level field (strict)", () => {
    const result = schema.safeParse({ ...minimal(), unexpectedField: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown nested field (strict)", () => {
    const value = minimal() as Record<string, unknown>;
    const source = value.source as Record<string, unknown>;
    const result = schema.safeParse({ ...value, source: { ...source, unexpectedField: "nope" } });
    expect(result.success).toBe(false);
  });
});

describe("generic-evidence-json@1 specific validation", () => {
  it("rejects an invalid enum value", () => {
    const value = minimalGenericEvidence();
    (value.reviewer as Record<string, unknown>).independentContext = "not_a_valid_enum";
    expect(GenericEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects an invalid timestamp", () => {
    const value = minimalGenericEvidence();
    (value.binding as Record<string, unknown>).capturedAt = "not-a-timestamp";
    expect(GenericEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects an empty required string", () => {
    const value = minimalGenericEvidence();
    (value.source as Record<string, unknown>).providerId = "";
    expect(GenericEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects a string exceeding the bounded-short-string max", () => {
    const value = minimalGenericEvidence();
    (value.source as Record<string, unknown>).providerId = "x".repeat(BOUNDED_SHORT_STRING_MAX + 1);
    expect(GenericEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects duplicate findingId within the same payload", () => {
    const value = minimalGenericEvidence({
      findings: [
        { findingId: "F1", title: "a", summary: "b" },
        { findingId: "F1", title: "c", summary: "d" },
      ],
    });
    expect(GenericEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects duplicate artifactId within the same payload", () => {
    const value = minimalGenericEvidence({
      artifacts: [
        { artifactId: "A1", kind: "log", locator: "a.txt" },
        { artifactId: "A1", kind: "log", locator: "b.txt" },
      ],
    });
    expect(GenericEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects duplicate escalationLocalId within the same payload", () => {
    const value = minimalGenericEvidence({
      decisionEscalations: [
        { escalationLocalId: "E1", category: "other", question: "q", rationale: "r" },
        { escalationLocalId: "E1", category: "other", question: "q2", rationale: "r2" },
      ],
    });
    expect(GenericEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("rejects more than the maximum allowed findings", () => {
    const findings = Array.from({ length: EXTERNAL_EVIDENCE_MAX_FINDINGS + 1 }, (_, i) => ({
      findingId: `F${i}`,
      title: "t",
      summary: "s",
    }));
    expect(GenericEvidenceV1Schema.safeParse(minimalGenericEvidence({ findings })).success).toBe(false);
  });

  it("rejects more than the maximum allowed artifacts", () => {
    const artifacts = Array.from({ length: EXTERNAL_EVIDENCE_MAX_ARTIFACTS + 1 }, (_, i) => ({
      artifactId: `A${i}`,
      kind: "log",
      locator: "a.txt",
    }));
    expect(GenericEvidenceV1Schema.safeParse(minimalGenericEvidence({ artifacts })).success).toBe(false);
  });

});

describe("generic-ci-json@1 specific validation", () => {
  it("rejects duplicate checkId within checks", () => {
    const value = minimalGenericCi({
      checks: [
        { checkId: "C1", name: "n", status: "passed", summary: "s" },
        { checkId: "C1", name: "n2", status: "failed", summary: "s2" },
      ],
    });
    expect(GenericCiV1Schema.safeParse(value).success).toBe(false);
  });

  it("requires commitSha (unlike generic-evidence-json@1 where it is optional)", () => {
    const value = minimalGenericCi();
    delete (value.binding as Record<string, unknown>).commitSha;
    expect(GenericCiV1Schema.safeParse(value).success).toBe(false);
  });

  it("accepts every documented run status", () => {
    for (const status of ["passed", "failed", "partial", "cancelled", "not_run", "unknown"]) {
      const value = minimalGenericCi({ run: { status, completedAt: NOW, summary: "s" } });
      expect(GenericCiV1Schema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an invalid run status enum", () => {
    const value = minimalGenericCi({ run: { status: "bogus", completedAt: NOW, summary: "s" } });
    expect(GenericCiV1Schema.safeParse(value).success).toBe(false);
  });
});

describe("manual-evidence-json@1 specific validation", () => {
  it("has no reviewerType field (fixed to human by the adapter, not payload-supplied)", () => {
    const value = minimalManualEvidence({ reviewer: { reviewerType: "agent", independentContext: "declared_independent" } });
    expect(ManualEvidenceV1Schema.safeParse(value).success).toBe(false);
  });

  it("has no repositoryFingerprint/workingTreeFingerprint fields in binding", () => {
    const value = minimalManualEvidence();
    (value.binding as Record<string, unknown>).repositoryFingerprint = "fp";
    expect(ManualEvidenceV1Schema.safeParse(value).success).toBe(false);
  });
});
