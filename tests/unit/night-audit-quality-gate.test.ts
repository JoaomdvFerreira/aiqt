import { describe, it, expect } from "vitest";
import { evaluateAuditFinding } from "../../src/workflow/night-audit-quality-gate.js";
import type { AuditFinding } from "../../src/schema/night-audit.schema.js";

function finding(overrides: Partial<AuditFinding> = {}): Pick<AuditFinding, "disposition" | "confidence" | "significance" | "evidence"> {
  return {
    disposition: "actionable",
    confidence: "strong_signal",
    significance: "medium",
    evidence: [{ evidenceId: "ev-1", description: "d", locator: "a.ts:1" }],
    ...overrides,
  };
}

describe("evaluateAuditFinding (build spec Sec 8 quality gate)", () => {
  it("accepts an actionable, evidenced, strong-signal-or-better, non-informational finding", () => {
    expect(evaluateAuditFinding(finding()).decision).toBe("accept");
    expect(evaluateAuditFinding(finding({ confidence: "proven" })).decision).toBe("accept");
  });

  it("rejects a non-actionable disposition", () => {
    const result = evaluateAuditFinding(finding({ disposition: "informational" }));
    expect(result.decision).toBe("reject");
    expect(result.reasons.join(" ")).toContain("not actionable");
  });

  it("rejects a suppressed_benign_pattern disposition", () => {
    expect(evaluateAuditFinding(finding({ disposition: "suppressed_benign_pattern" })).decision).toBe("reject");
  });

  it("rejects empty evidence", () => {
    const result = evaluateAuditFinding(finding({ evidence: [] }));
    expect(result.decision).toBe("reject");
    expect(result.reasons.join(" ")).toContain("no evidence");
  });

  it("rejects weak_signal and unsupported confidence", () => {
    expect(evaluateAuditFinding(finding({ confidence: "weak_signal" })).decision).toBe("reject");
    expect(evaluateAuditFinding(finding({ confidence: "unsupported" })).decision).toBe("reject");
  });

  it("rejects informational significance", () => {
    const result = evaluateAuditFinding(finding({ significance: "informational" }));
    expect(result.decision).toBe("reject");
    expect(result.reasons.join(" ")).toContain("informational");
  });

  it("reports every applicable reason, not just the first", () => {
    const result = evaluateAuditFinding(finding({ disposition: "informational", evidence: [], confidence: "unsupported", significance: "informational" }));
    expect(result.reasons).toHaveLength(4);
  });

  it("evaluates identically regardless of which domain produced the finding -- no domain-specific leniency", () => {
    const a = evaluateAuditFinding(finding());
    const b = evaluateAuditFinding(finding());
    expect(a).toEqual(b);
  });
});
