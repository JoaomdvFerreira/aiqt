import { describe, it, expect } from "vitest";
import { structuralFindingToDiscoveryCandidate } from "../../src/workflow/structural-finding-defect-adapter.js";
import { intakeStructuralFinding } from "../../src/services/structural-finding-intake-service.js";
import { graphifyProvider } from "../../src/workflow/structural-providers/graphify-provider.js";
import type { StructuralFinding } from "../../src/schema/structural-review.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

const NOW = "2026-08-08T00:00:00.000Z";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function makeFinding(overrides: Partial<StructuralFinding> = {}): StructuralFinding {
  return {
    findingKey: "sha256:" + "a".repeat(64),
    domain: "ownership_divergence",
    ruleId: "owner-map-path-missing",
    title: "Owner map entry references a missing path",
    explanation: "explanation",
    reviewCommit: COMMIT_A,
    affectedPaths: ["src/x.ts"],
    evidence: [{ evidenceId: "E1", description: "d", locator: "src/x.ts" }],
    confidence: "proven",
    significance: "medium",
    reasonCodes: ["OWNER_MAP_PATH_MISSING"],
    evidenceGaps: [],
    disposition: "actionable",
    eligibleForIntake: true,
    recommendedNextAction: "Fix it",
    providerSource: "repository-local",
    ...overrides,
  };
}

describe("structuralFindingToDiscoveryCandidate", () => {
  it("maps significance/confidence to the defect scales deterministically", () => {
    const candidate = structuralFindingToDiscoveryCandidate(makeFinding({ significance: "critical", confidence: "proven" }), NOW);
    expect(candidate.severity).toBe("critical");
    expect(candidate.confidence).toBe("confirmed");
    expect(candidate.sourceKind).toBe("review_finding");
  });

  it("maps weak_signal/informational to the conservative end of the defect scale", () => {
    const candidate = structuralFindingToDiscoveryCandidate(makeFinding({ significance: "informational", confidence: "weak_signal" }), NOW);
    expect(candidate.severity).toBe("info");
    expect(candidate.confidence).toBe("suspected");
  });

  it("uses the structural findingKey as the defect fingerprint evidence signature (1:1 identity)", () => {
    const finding = makeFinding();
    const candidate = structuralFindingToDiscoveryCandidate(finding, NOW);
    expect(candidate.fingerprintInput.evidenceSignature).toBe(finding.findingKey);
  });
});

describe("intakeStructuralFinding", () => {
  it("rejects a stale finding without creating a defect", () => {
    const finding = makeFinding({ reviewCommit: COMMIT_A });
    const outcome = intakeStructuralFinding(finding, COMMIT_B, [], NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.stale).toBe(true);
  });

  it("rejects a non-actionable finding", () => {
    const finding = makeFinding({ disposition: "informational", eligibleForIntake: false });
    const outcome = intakeStructuralFinding(finding, COMMIT_A, [], NOW);
    expect(outcome.ok).toBe(false);
  });

  it("rejects a suppressed_benign_pattern finding even if eligibleForIntake were somehow true", () => {
    const finding = makeFinding({ disposition: "suppressed_benign_pattern" });
    const outcome = intakeStructuralFinding(finding, COMMIT_A, [], NOW);
    expect(outcome.ok).toBe(false);
  });

  it("creates a new candidate-status defect from a fresh, eligible finding, reusing M42 dedup", () => {
    const finding = makeFinding();
    const outcome = intakeStructuralFinding(finding, COMMIT_A, [], NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.created).toHaveLength(1);
      expect(outcome.result.created[0].status).toBe("candidate");
      expect(outcome.result.created[0].sourceKind).toBe("review_finding");
    }
  });

  it("enriches an existing defect with the same fingerprint instead of duplicating", () => {
    const finding = makeFinding();
    const first = intakeStructuralFinding(finding, COMMIT_A, [], NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = intakeStructuralFinding(finding, COMMIT_A, first.result.defects, NOW);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.result.created).toHaveLength(0);
      expect(second.result.enriched).toHaveLength(1);
    }
  });

  it("intake alone never sets a status beyond candidate (no remediation authorization)", () => {
    const finding = makeFinding({ significance: "critical", confidence: "proven" });
    const outcome = intakeStructuralFinding(finding, COMMIT_A, [], NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.created[0].status).toBe("candidate");
      expect(outcome.result.created[0].remediation).toBeUndefined();
    }
  });
});

describe("graphifyProvider (honest optional-provider pilot)", () => {
  it("reports unavailable deterministically without any network/credential probe", () => {
    const status = graphifyProvider.checkAvailability(process.cwd());
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
  });

  it("collectEvidence fails safe to an empty array rather than fabricating a finding", () => {
    expect(graphifyProvider.collectEvidence(process.cwd(), "a".repeat(40))).toEqual([]);
  });

  const existingDefect: DefectRecord = {
    defectId: "DEF-999",
    title: "unused",
    summary: "unused",
    sourceKind: "review_finding",
    evidenceRefs: [{ evidenceRefId: "E", sourceKind: "review_finding", locator: "x", capturedAt: NOW }],
    fingerprint: "sha256:" + "9".repeat(64),
    severity: "low",
    confidence: "confirmed",
    status: "invalid",
    freshness: { state: "current", evaluatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
  };
  it("sanity: unrelated existing defects are untouched by an unrelated intake", () => {
    const finding = makeFinding();
    const outcome = intakeStructuralFinding(finding, COMMIT_A, [existingDefect], NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.defects.find((d) => d.defectId === "DEF-999")?.status).toBe("invalid");
    }
  });
});
