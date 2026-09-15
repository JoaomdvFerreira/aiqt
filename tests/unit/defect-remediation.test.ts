import { describe, it, expect } from "vitest";
import { computeRemediationRisk, classifyRemediationRiskBand } from "../../src/workflow/remediation-risk.js";
import { prepareRemediation, recordRemediationValidation } from "../../src/services/defect-remediation-service.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

const NOW = "2026-08-08T00:00:00.000Z";

function makeDefect(overrides: Partial<DefectRecord> = {}): DefectRecord {
  return {
    defectId: "DEF-001",
    title: "t",
    summary: "s",
    sourceKind: "failed_validation",
    evidenceRefs: [{ evidenceRefId: "E1", sourceKind: "failed_validation", locator: "x", capturedAt: NOW }],
    fingerprint: "sha256:" + "a".repeat(64),
    severity: "high",
    confidence: "confirmed",
    status: "queued",
    freshness: { state: "current", evaluatedAt: NOW },
    affectedWorkUnitId: "WU-001",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("classifyRemediationRiskBand", () => {
  it("matches the exact repository four-band boundaries", () => {
    expect(classifyRemediationRiskBand(24)).toBe("green");
    expect(classifyRemediationRiskBand(25)).toBe("yellow");
    expect(classifyRemediationRiskBand(49)).toBe("yellow");
    expect(classifyRemediationRiskBand(50)).toBe("orange");
    expect(classifyRemediationRiskBand(74)).toBe("orange");
    expect(classifyRemediationRiskBand(75)).toBe("red");
    expect(classifyRemediationRiskBand(100)).toBe("red");
  });
});

describe("computeRemediationRisk", () => {
  it("scores a single narrow, bounded, non-foundational file low (< 50)", () => {
    const risk = computeRemediationRisk({ scope: ["src/cli/commands/example.command.ts"], affectedWorkUnitId: "WU-001" });
    expect(risk.score).toBeLessThan(50);
    expect(risk.requiresHumanApproval).toBe(false);
  });

  it("scores foundational-path scope at or above the human boundary", () => {
    const risk = computeRemediationRisk({ scope: ["src/schema/state.schema.ts"], affectedWorkUnitId: "WU-001" });
    expect(risk.score).toBeGreaterThanOrEqual(50);
    expect(risk.requiresHumanApproval).toBe(true);
    expect(risk.reasonCodes).toContain("TOUCHES_FOUNDATIONAL_PATH");
  });

  it("scores an empty/unbounded scope with no bound Work Unit as high risk", () => {
    const risk = computeRemediationRisk({ scope: [] });
    expect(risk.requiresHumanApproval).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const a = computeRemediationRisk({ scope: ["a.ts", "b.ts"], affectedWorkUnitId: "WU-001" });
    const b = computeRemediationRisk({ scope: ["a.ts", "b.ts"], affectedWorkUnitId: "WU-001" });
    expect(a).toEqual(b);
  });

  it("never exceeds the 0-100 bound", () => {
    const risk = computeRemediationRisk({ scope: Array.from({ length: 50 }, (_, i) => `src/schema/x${i}.ts`) });
    expect(risk.score).toBeLessThanOrEqual(100);
  });
});

describe("prepareRemediation", () => {
  const baseInput = {
    remediationId: "REM-001",
    objective: "Fix the failing test",
    scope: ["src/cli/commands/example.command.ts"],
    outOfScope: ["src/schema/"],
    acceptanceContract: "The previously failing test passes",
    now: NOW,
  };

  it("rejects a defect that is not queued", () => {
    const outcome = prepareRemediation({ defect: makeDefect({ status: "candidate" }), ...baseInput });
    expect(outcome.ok).toBe(false);
  });

  it("proceeds automatically for low-risk scope without requiring approval", () => {
    const outcome = prepareRemediation({ defect: makeDefect(), ...baseInput });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.defect.status).toBe("in_progress");
      expect(outcome.remediation.remediationRiskBand).toBe("green");
      expect(outcome.remediation.approvedBy).toBeUndefined();
    }
  });

  it("blocks a high-risk (foundational-path) remediation without --approved-by, changing nothing", () => {
    const outcome = prepareRemediation({
      defect: makeDefect(),
      ...baseInput,
      scope: ["src/schema/state.schema.ts"],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.requiresHumanApproval).toBe(true);
  });

  it("proceeds for high-risk scope once an explicit human approver is supplied", () => {
    const outcome = prepareRemediation({
      defect: makeDefect(),
      ...baseInput,
      scope: ["src/schema/state.schema.ts"],
      approvedBy: "maintainer@example.com",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.defect.status).toBe("in_progress");
      expect(outcome.remediation.approvedBy).toBe("maintainer@example.com");
      expect(outcome.remediation.approvalRequired).toBe(true);
      expect(["orange", "red"]).toContain(outcome.remediation.remediationRiskBand);
    }
  });

  it("keeps remediation risk independent of defect severity (a critical defect with narrow scope is still low risk)", () => {
    const outcome = prepareRemediation({ defect: makeDefect({ severity: "critical" }), ...baseInput });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.remediation.remediationRiskBand).toBe("green");
  });
});

describe("recordRemediationValidation", () => {
  function inProgressDefect(): DefectRecord {
    const prepared = prepareRemediation({
      defect: makeDefect(),
      remediationId: "REM-001",
      objective: "obj",
      scope: ["src/x.ts"],
      outOfScope: [],
      acceptanceContract: "acc",
      now: NOW,
    });
    if (!prepared.ok) throw new Error("setup failed");
    return prepared.defect;
  }

  it("rejects recording validation on a defect with no in-progress remediation", () => {
    const outcome = recordRemediationValidation({ defect: makeDefect({ status: "queued" }), outcome: "passed", evidenceLocator: "x", now: NOW });
    expect(outcome.ok).toBe(false);
  });

  it("a self-reported passed validation remains visible but needs human resolution", () => {
    const outcome = recordRemediationValidation({ defect: inProgressDefect(), outcome: "passed", evidenceLocator: "pnpm test -- example.test.ts", now: NOW });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.defect.status).toBe("needs_human");
      expect(outcome.defect.resolution).toBeUndefined();
      expect(outcome.defect.remediationEvidence?.[0].evidenceRefs[0].sourceKind).toBe("human_reported");
      expect(outcome.defect.remediation?.outcome).toBe("validation_passed");
    }
  });


  it("a failed validation returns the defect to the queue with failure evidence preserved, not silently closed", () => {
    const outcome = recordRemediationValidation({ defect: inProgressDefect(), outcome: "failed", evidenceLocator: "pnpm test -- example.test.ts still failing", now: NOW });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.defect.status).toBe("queued");
      expect(outcome.defect.resolution).toBeUndefined();
      expect(outcome.defect.remediationEvidence?.length).toBe(1);
      expect(outcome.defect.remediation?.outcome).toBe("validation_failed");
    }
  });
});
