import { describe, expect, it } from "vitest";
import {
  deriveChangeQualification,
  deriveProductionVerification,
} from "../../src/workflow/production-qualification.js";

describe("M49 production qualification", () => {
  it("is deterministic and revision-specific", () => {
    const input = {
      workUnitId: "WU-1",
      revision: "a".repeat(40),
      requirements: [{ requirementId: "validation", title: "Validation", outcome: "PASS" as const }],
    };
    expect(deriveChangeQualification(input)).toEqual(deriveChangeQualification(input));
    expect(deriveChangeQualification({ ...input, revision: null }).status).toBe("UNKNOWN");
  });

  it("never silently qualifies failed or unknown evidence", () => {
    expect(deriveChangeQualification({
      workUnitId: "WU-1", revision: "a".repeat(40),
      requirements: [{ requirementId: "validation", title: "Validation", outcome: "FAIL" }],
    }).status).toBe("BLOCKED");
    expect(deriveChangeQualification({
      workUnitId: "WU-1", revision: "a".repeat(40),
      requirements: [{ requirementId: "evidence", title: "Evidence", outcome: "UNKNOWN" }],
    }).status).toBe("UNKNOWN");
  });

  it("keeps a technical failure when scoped authority permits progression", () => {
    const qualification = deriveChangeQualification({
      workUnitId: "WU-1",
      revision: "a".repeat(40),
      requirements: [{ requirementId: "validation", title: "Validation", outcome: "FAIL" }],
      decisions: [{ decisionId: "EX-1", requirementIds: ["validation"], permitsProgress: true, authority: "release-owner", reason: "bounded exception" }],
    });
    expect(qualification.status).toBe("QUALIFIED");
    expect(qualification.requirements[0].outcome).toBe("FAIL");
    expect(qualification.reasons.some((reason) => reason.code === "accepted_exception")).toBe(true);
  });

  it("keeps production verification separate and applicability-based", () => {
    expect(deriveProductionVerification({ applicable: false, outcomes: [] })).toBe("NOT_APPLICABLE");
    expect(deriveProductionVerification({ applicable: true, outcomes: [] })).toBe("UNKNOWN");
    expect(deriveProductionVerification({ applicable: true, outcomes: ["PASS"] })).toBe("VERIFIED");
    expect(deriveProductionVerification({ applicable: true, outcomes: ["FAIL", "PASS"] })).toBe("FAILED");
  });
});
