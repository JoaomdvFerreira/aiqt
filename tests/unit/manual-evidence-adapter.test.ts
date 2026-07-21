import { describe, it, expect } from "vitest";
import {
  normalizeManualEvidenceV1,
  MANUAL_EVIDENCE_V1_TRUST_LEVEL,
} from "../../src/evidence/adapters/manual-evidence-v1.adapter.js";
import type { ManualEvidenceV1 } from "../../src/schema/external-evidence/manual-evidence-v1.schema.js";

const NOW = "2026-01-01T00:00:00.000Z";
const DIGEST = "sha256:" + "c".repeat(64);

function payload(overrides: Partial<ManualEvidenceV1> = {}): ManualEvidenceV1 {
  return {
    format: "manual-evidence-json@1",
    source: { providerId: "prov-manual" },
    binding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1", capturedAt: NOW },
    reviewer: { independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    ...overrides,
  } as ManualEvidenceV1;
}

describe("normalizeManualEvidenceV1 (WU23-05)", () => {
  it("fixes reviewerType to 'human' -- the payload has no reviewerType field to trust", () => {
    const candidate = normalizeManualEvidenceV1(payload(), DIGEST);
    expect(candidate.reviewer.reviewerType).toBe("human");
    expect(candidate.provider.providerType).toBe("human");
  });

  it("fixes the trust ceiling to self_reported, never elevated", () => {
    const candidate = normalizeManualEvidenceV1(payload(), DIGEST);
    expect(candidate.provider.trustLevel).toBe("self_reported");
    expect(candidate.provider.trustLevel).toBe(MANUAL_EVIDENCE_V1_TRUST_LEVEL);
    expect(candidate.provider.trustLevel).not.toBe("repository_local");
    expect(candidate.provider.trustLevel).not.toBe("platform_verified");
  });

  it("carries externalId through as externalEvidenceId when present", () => {
    const candidate = normalizeManualEvidenceV1(payload({ externalId: "ext-9" }), DIGEST);
    expect(candidate.externalEvidenceId).toBe("ext-9");
  });

  it("has no repositoryFingerprint/workingTreeFingerprint (format has no such fields)", () => {
    const candidate = normalizeManualEvidenceV1(payload(), DIGEST);
    expect(candidate.codeBinding.repositoryFingerprint).toBeUndefined();
    expect(candidate.codeBinding.workingTreeFingerprint).toBeUndefined();
  });

  it("maps findings and artifacts using the shared mapping helpers", () => {
    const candidate = normalizeManualEvidenceV1(
      payload({
        findings: [{ findingId: "F1", title: "t", summary: "s" }],
        artifacts: [{ artifactId: "A1", kind: "screenshot", locator: "shots/a.png" }],
      }),
      DIGEST,
    );
    expect(candidate.sourceFindings).toHaveLength(1);
    expect(candidate.sourceFindings[0].sourceFindingId).toBe("F1");
    expect(candidate.artifactReferences).toHaveLength(1);
    expect(candidate.artifactReferences[0].artifactId).toBe("A1");
  });

  it("maps decision escalation candidates through (manual evidence may propose escalations)", () => {
    const candidate = normalizeManualEvidenceV1(
      payload({
        decisionEscalations: [{ escalationLocalId: "E1", category: "product", question: "q", rationale: "r" }],
      }),
      DIGEST,
    );
    expect(candidate.decisionEscalationCandidates).toEqual([
      { localId: "E1", category: "product", question: "q", rationale: "r", proposedAnswer: undefined },
    ]);
  });
});
