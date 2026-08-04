import { describe, expect, it } from "vitest";
import type { AutonomousCandidate } from "../../src/schema/autonomous-run.schema.js";
import {
  classifyCandidate,
  isAlwaysBlocked,
  requiresApproval,
  canProceedWithoutApproval,
  type ClassifyCandidateInput,
} from "../../src/workflow/autonomous-run-safety-classifier.js";

function baseCandidate(overrides: Partial<AutonomousCandidate> = {}): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "issue",
    repository: "example/repo",
    baseRef: "refs/heads/main",
    objective: "Fix a null check in the parser",
    acceptanceCriteria: ["parser no longer throws on empty input"],
    constraints: [],
    requestedPermissions: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<ClassifyCandidateInput> = {}): ClassifyCandidateInput {
  return {
    candidate: baseCandidate(),
    repositoryDirty: false,
    baseRefResolvable: true,
    validationCommandsAvailable: true,
    prohibitedAreaTags: [],
    ...overrides,
  };
}

describe("M36-WU01: fail-closed candidate safety classification", () => {
  it("classifies a clean, fully-specified, unprivileged candidate as low_risk_autonomous", () => {
    const result = classifyCandidate(baseInput());
    expect(result.riskClass).toBe("low_risk_autonomous");
    expect(result.requiredApprovals).toEqual([]);
  });

  it("fails closed to repository_dirty when the working tree is not clean, regardless of other inputs", () => {
    const result = classifyCandidate(baseInput({ repositoryDirty: true }));
    expect(result.riskClass).toBe("repository_dirty");
  });

  it("fails closed to insufficient_context when the base ref cannot be resolved", () => {
    const result = classifyCandidate(baseInput({ baseRefResolvable: false }));
    expect(result.riskClass).toBe("insufficient_context");
  });

  it("fails closed to insufficient_context when acceptance criteria is empty", () => {
    const result = classifyCandidate(baseInput({ candidate: baseCandidate({ acceptanceCriteria: [] }) }));
    expect(result.riskClass).toBe("insufficient_context");
  });

  it("fails closed to insufficient_context when the objective is blank", () => {
    const result = classifyCandidate(baseInput({ candidate: baseCandidate({ objective: "   " }) }));
    expect(result.riskClass).toBe("insufficient_context");
  });

  it("fails closed to validation_unavailable when no validation command exists", () => {
    const result = classifyCandidate(baseInput({ validationCommandsAvailable: false }));
    expect(result.riskClass).toBe("validation_unavailable");
  });

  it("fails closed to high_risk_prohibited when the candidate touches a prohibited area", () => {
    const result = classifyCandidate(baseInput({ prohibitedAreaTags: ["secrets"] }));
    expect(result.riskClass).toBe("high_risk_prohibited");
    expect(result.prohibitedAreas).toContain("secrets");
  });

  it("classifies medium_risk_requires_approval when elevated permissions are requested but nothing else is wrong", () => {
    const result = classifyCandidate(
      baseInput({ candidate: baseCandidate({ requestedPermissions: ["network"] }) }),
    );
    expect(result.riskClass).toBe("medium_risk_requires_approval");
    expect(result.requiredApprovals).toEqual(["human_operator"]);
  });

  it("prohibited-area check takes precedence over a permission request when both are present", () => {
    const result = classifyCandidate(
      baseInput({
        candidate: baseCandidate({ requestedPermissions: ["network"] }),
        prohibitedAreaTags: ["billing"],
      }),
    );
    expect(result.riskClass).toBe("high_risk_prohibited");
  });

  it("repository-dirty precedes every other check (checked first)", () => {
    const result = classifyCandidate(
      baseInput({ repositoryDirty: true, baseRefResolvable: false, validationCommandsAvailable: false }),
    );
    expect(result.riskClass).toBe("repository_dirty");
  });

  it("every assessment's networkPolicy defaults to denied", () => {
    expect(classifyCandidate(baseInput()).networkPolicy).toBe("denied");
    expect(classifyCandidate(baseInput({ prohibitedAreaTags: ["secrets"] })).networkPolicy).toBe("denied");
  });
});

describe("M36-WU01: risk-class approval-gate predicates", () => {
  it("high_risk_prohibited is always blocked and never requires (only) approval", () => {
    expect(isAlwaysBlocked("high_risk_prohibited")).toBe(true);
    expect(requiresApproval("high_risk_prohibited")).toBe(false);
    expect(canProceedWithoutApproval("high_risk_prohibited")).toBe(false);
  });

  it("medium_risk_requires_approval requires approval and is not always-blocked", () => {
    expect(isAlwaysBlocked("medium_risk_requires_approval")).toBe(false);
    expect(requiresApproval("medium_risk_requires_approval")).toBe(true);
    expect(canProceedWithoutApproval("medium_risk_requires_approval")).toBe(false);
  });

  it("low_risk_autonomous can proceed without approval", () => {
    expect(isAlwaysBlocked("low_risk_autonomous")).toBe(false);
    expect(requiresApproval("low_risk_autonomous")).toBe(false);
    expect(canProceedWithoutApproval("low_risk_autonomous")).toBe(true);
  });

  it.each(["insufficient_context", "validation_unavailable", "repository_dirty", "unsupported_operation"] as const)(
    "%s is always blocked",
    (riskClass) => {
      expect(isAlwaysBlocked(riskClass)).toBe(true);
      expect(canProceedWithoutApproval(riskClass)).toBe(false);
    },
  );
});
