import { describe, it, expect } from "vitest";
import { computeAuditFindingFingerprint, computeAuditFindingFingerprintFromFinding } from "../../src/workflow/night-audit-fingerprint.js";
import type { AuditFinding } from "../../src/schema/night-audit.schema.js";

describe("computeAuditFindingFingerprint (build spec Sec 7/9)", () => {
  it("is deterministic for identical structural identity", () => {
    const input = { domain: "code_quality" as const, checkId: "duplicate-logic", scope: "src/services/", affectedPaths: ["a.ts", "b.ts"], evidenceLocators: ["a.ts:1", "b.ts:1"] };
    expect(computeAuditFindingFingerprint(input)).toBe(computeAuditFindingFingerprint(input));
  });

  it("is order-independent for affectedPaths/evidenceLocators", () => {
    const a = computeAuditFindingFingerprint({ domain: "code_quality", checkId: "x", scope: "s", affectedPaths: ["a.ts", "b.ts"], evidenceLocators: ["a.ts:1", "b.ts:1"] });
    const b = computeAuditFindingFingerprint({ domain: "code_quality", checkId: "x", scope: "s", affectedPaths: ["b.ts", "a.ts"], evidenceLocators: ["b.ts:1", "a.ts:1"] });
    expect(a).toBe(b);
  });

  it("changes when checkId changes, even with identical evidence", () => {
    const base = { domain: "code_quality" as const, scope: "s", affectedPaths: ["a.ts"], evidenceLocators: ["a.ts:1"] };
    expect(computeAuditFindingFingerprint({ ...base, checkId: "x" })).not.toBe(computeAuditFindingFingerprint({ ...base, checkId: "y" }));
  });

  it("changes when domain changes", () => {
    const base = { checkId: "x", scope: "s", affectedPaths: ["a.ts"], evidenceLocators: ["a.ts:1"] };
    expect(computeAuditFindingFingerprint({ ...base, domain: "code_quality" })).not.toBe(computeAuditFindingFingerprint({ ...base, domain: "documentation" }));
  });

  it("never depends on title/explanation text -- two findings with different narrative but identical structural identity fingerprint the same", () => {
    const finding1: Omit<AuditFinding, "findingKey"> = {
      domain: "code_quality",
      checkId: "duplicate-logic",
      title: "Title A",
      explanation: "Explanation A, very different wording.",
      reviewCommit: "a".repeat(40),
      scope: "src/services/",
      affectedPaths: ["src/services/a.ts"],
      evidence: [{ evidenceId: "ev-1", description: "d", locator: "src/services/a.ts:1" }],
      confidence: "strong_signal",
      significance: "medium",
      disposition: "actionable",
      recommendedNextAction: "Fix it",
    };
    const finding2: Omit<AuditFinding, "findingKey"> = { ...finding1, title: "Title B", explanation: "Totally different narrative." };
    expect(computeAuditFindingFingerprintFromFinding(finding1)).toBe(computeAuditFindingFingerprintFromFinding(finding2));
  });
});
