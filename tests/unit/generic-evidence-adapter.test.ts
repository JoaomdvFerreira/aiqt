import { describe, it, expect } from "vitest";
import {
  normalizeGenericEvidenceV1,
  UnsafeArtifactLocatorError,
  GENERIC_EVIDENCE_V1_TRUST_LEVEL,
} from "../../src/evidence/adapters/generic-evidence-v1.adapter.js";
import type { GenericEvidenceV1 } from "../../src/schema/external-evidence/generic-evidence-v1.schema.js";
import { computeSourceFingerprint } from "../../src/workflow/finding-fingerprint.js";

const NOW = "2026-01-01T00:00:00.000Z";
const DIGEST = "sha256:" + "a".repeat(64);

function minimalPayload(overrides: Partial<GenericEvidenceV1> = {}): GenericEvidenceV1 {
  return {
    format: "generic-evidence-json@1",
    source: { providerId: "prov-1", providerType: "agent" },
    binding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1", capturedAt: NOW },
    reviewer: { reviewerType: "agent", independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    ...overrides,
  } as GenericEvidenceV1;
}

describe("normalizeGenericEvidenceV1 (WU23-03)", () => {
  it("maps a minimal payload into a NormalizedEvidenceCandidate with the fixed trust ceiling", () => {
    const candidate = normalizeGenericEvidenceV1(minimalPayload(), DIGEST);
    expect(candidate.adapterId).toBe("generic-evidence-json@1");
    expect(candidate.sourcePayloadDigest).toBe(DIGEST);
    expect(candidate.externalEvidenceId).toBeNull();
    expect(candidate.provider.trustLevel).toBe("unverified");
    expect(candidate.provider.trustLevel).toBe(GENERIC_EVIDENCE_V1_TRUST_LEVEL);
    expect(candidate.workflowBinding.checkpointId).toBeNull();
    expect(candidate.sourceFindings).toEqual([]);
    expect(candidate.artifactReferences).toEqual([]);
    expect(candidate.decisionEscalationCandidates).toEqual([]);
  });

  it("never elevates trust level even if the payload cannot express one (payload has no trust field at all)", () => {
    const candidate = normalizeGenericEvidenceV1(minimalPayload(), DIGEST);
    expect(candidate.provider.trustLevel).not.toBe("repository_local");
    expect(candidate.provider.trustLevel).not.toBe("platform_verified");
  });

  it("maps providerType 'system' to 'unknown' rather than a verification-implying value", () => {
    const candidate = normalizeGenericEvidenceV1(
      minimalPayload({ source: { providerId: "p", providerType: "system" } }),
      DIGEST,
    );
    expect(candidate.provider.providerType).toBe("unknown");
  });

  it("carries externalId through as externalEvidenceId when present", () => {
    const candidate = normalizeGenericEvidenceV1(minimalPayload({ externalId: "ext-1" }), DIGEST);
    expect(candidate.externalEvidenceId).toBe("ext-1");
  });

  it("computes the M22-owned source fingerprint identically to computeSourceFingerprint", () => {
    const payload = minimalPayload({
      findings: [{ findingId: "F1", title: "Title", summary: "Summary", relatedIds: ["X"] }],
    });
    const candidate = normalizeGenericEvidenceV1(payload, DIGEST);
    expect(candidate.sourceFindings).toHaveLength(1);
    expect(candidate.sourceFindings[0].sourceFingerprint).toBe(
      computeSourceFingerprint({ title: "Title", summary: "Summary", relatedIds: ["X"], scopeClaim: "unknown" }),
    );
  });

  it("defaults omitted finding claims to 'unknown' rather than guessing a value", () => {
    const payload = minimalPayload({
      findings: [{ findingId: "F1", title: "t", summary: "s" }],
    });
    const candidate = normalizeGenericEvidenceV1(payload, DIGEST);
    expect(candidate.sourceFindings[0].sourceSeverityClaim).toBe("unknown");
    expect(candidate.sourceFindings[0].sourceFixabilityClaim).toBe("unknown");
    expect(candidate.sourceFindings[0].scopeClaim).toBe("unknown");
  });

  it("maps a safe artifact locator through unchanged", () => {
    const payload = minimalPayload({
      artifacts: [{ artifactId: "A1", kind: "log", locator: "logs/a.txt" }],
    });
    const candidate = normalizeGenericEvidenceV1(payload, DIGEST);
    expect(candidate.artifactReferences[0].locator).toBe("logs/a.txt");
  });

  it("throws UnsafeArtifactLocatorError for an unsafe artifact locator, identifying the artifactId", () => {
    const payload = minimalPayload({
      artifacts: [{ artifactId: "A1", kind: "log", locator: "/etc/passwd" }],
    });
    expect(() => normalizeGenericEvidenceV1(payload, DIGEST)).toThrow(UnsafeArtifactLocatorError);
    try {
      normalizeGenericEvidenceV1(payload, DIGEST);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeArtifactLocatorError);
      expect((error as UnsafeArtifactLocatorError).artifactId).toBe("A1");
    }
  });

  it("maps decision escalation candidates through with their local IDs preserved", () => {
    const payload = minimalPayload({
      decisionEscalations: [{ escalationLocalId: "E1", category: "security", question: "q", rationale: "r" }],
    });
    const candidate = normalizeGenericEvidenceV1(payload, DIGEST);
    expect(candidate.decisionEscalationCandidates).toEqual([
      { localId: "E1", category: "security", question: "q", rationale: "r", proposedAnswer: undefined },
    ]);
  });
});
