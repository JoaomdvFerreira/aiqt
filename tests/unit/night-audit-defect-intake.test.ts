import { describe, it, expect } from "vitest";
import { auditFindingToDiscoveryCandidate } from "../../src/workflow/night-audit-finding-defect-adapter.js";
import { intakeAuditFinding } from "../../src/services/night-audit-defect-intake-service.js";
import type { AuditFinding, NightReviewDomain } from "../../src/schema/night-audit.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    findingKey: "sha256:" + "a".repeat(64),
    domain: "code_quality" as NightReviewDomain,
    checkId: "duplicate-logic",
    title: "Duplicate retry logic",
    explanation: "explanation",
    reviewCommit: COMMIT_A,
    scope: "src/services/",
    affectedPaths: ["src/services/a.ts", "src/services/b.ts"],
    evidence: [{ evidenceId: "ev-1", description: "d", locator: "src/services/a.ts:10" }],
    confidence: "strong_signal",
    significance: "medium",
    disposition: "actionable",
    recommendedNextAction: "Extract a shared helper.",
    ...overrides,
  };
}

describe("auditFindingToDiscoveryCandidate", () => {
  it("maps significance/confidence to the defect scales deterministically", () => {
    const candidate = auditFindingToDiscoveryCandidate(makeFinding({ significance: "critical", confidence: "proven" }), NOW);
    expect(candidate.severity).toBe("critical");
    expect(candidate.confidence).toBe("confirmed");
    expect(candidate.sourceKind).toBe("review_finding");
  });

  it("maps weak_signal/informational to the conservative end of the defect scale", () => {
    const candidate = auditFindingToDiscoveryCandidate(makeFinding({ significance: "informational", confidence: "weak_signal" }), NOW);
    expect(candidate.severity).toBe("info");
    expect(candidate.confidence).toBe("suspected");
  });

  it("uses the AuditFinding findingKey as the defect fingerprint evidence signature (1:1 identity)", () => {
    const finding = makeFinding();
    const candidate = auditFindingToDiscoveryCandidate(finding, NOW);
    expect(candidate.fingerprintInput.evidenceSignature).toBe(finding.findingKey);
  });
});

describe("intakeAuditFinding (build spec Sec 7/9)", () => {
  it("rejects a stale finding without creating a defect", () => {
    const finding = makeFinding({ reviewCommit: COMMIT_A });
    const outcome = intakeAuditFinding(finding, COMMIT_B, [], NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.stale).toBe(true);
  });

  it("rejects a finding that fails the quality gate (defense in depth, never trusts the caller alone)", () => {
    const finding = makeFinding({ disposition: "informational" });
    const outcome = intakeAuditFinding(finding, COMMIT_A, [], NOW);
    expect(outcome.ok).toBe(false);
  });

  it("creates a new candidate-status defect from a fresh, accepted finding, reusing M42 dedup", () => {
    const finding = makeFinding();
    const outcome = intakeAuditFinding(finding, COMMIT_A, [], NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.created).toHaveLength(1);
      expect(outcome.result.created[0].status).toBe("candidate");
      expect(outcome.result.created[0].sourceKind).toBe("review_finding");
      expect(outcome.matchedDefect.defectId).toBe(outcome.result.created[0].defectId);
      expect(outcome.alreadyPublished).toBe(false);
      expect(outcome.existingExternalIssueRef).toBeNull();
    }
  });

  it("enriches an existing defect with the same fingerprint instead of duplicating", () => {
    const finding = makeFinding();
    const first = intakeAuditFinding(finding, COMMIT_A, [], NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = intakeAuditFinding(finding, COMMIT_A, first.result.defects, NOW);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.result.created).toHaveLength(0);
      expect(second.result.enriched).toHaveLength(1);
    }
  });

  it("reports alreadyPublished=true when the matched defect already carries an externalIssueRef", () => {
    const finding = makeFinding();
    const first = intakeAuditFinding(finding, COMMIT_A, [], NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const publishedDefects: DefectRecord[] = first.result.defects.map((d) =>
      d.defectId === first.matchedDefect.defectId
        ? { ...d, externalIssueRef: { provider: "github", number: 7, url: "https://github.com/example/repo/issues/7", publishedAt: NOW } }
        : d,
    );
    const second = intakeAuditFinding(finding, COMMIT_A, publishedDefects, NOW);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.alreadyPublished).toBe(true);
      expect(second.existingExternalIssueRef?.number).toBe(7);
    }
  });

  it("intake alone never sets a status beyond candidate (no remediation authorization)", () => {
    const finding = makeFinding({ significance: "critical", confidence: "proven" });
    const outcome = intakeAuditFinding(finding, COMMIT_A, [], NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.created[0].status).toBe("candidate");
      expect(outcome.result.created[0].remediation).toBeUndefined();
    }
  });

  it("unrelated existing defects are untouched by an unrelated intake", () => {
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
    const finding = makeFinding();
    const outcome = intakeAuditFinding(finding, COMMIT_A, [existingDefect], NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.defects.find((d) => d.defectId === "DEF-999")?.status).toBe("invalid");
    }
  });
});
