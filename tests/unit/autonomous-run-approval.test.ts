import { describe, it, expect } from "vitest";
import { isApprovalRequired, computeApprovalBindingDigest, isApprovalStale } from "../../src/workflow/autonomous-run-approval.js";
import type { AutonomousCandidate, AutonomousBudgets } from "../../src/schema/autonomous-run.schema.js";

/**
 * M37-WU01 (build spec Sec 6.3 "Approval"). Pure unit tests -- no I/O.
 */
function candidate(overrides: Partial<AutonomousCandidate> = {}): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "manual",
    repository: "example/repo",
    baseRef: "HEAD",
    objective: "fix something",
    acceptanceCriteria: ["it works"],
    constraints: [],
    requestedPermissions: [],
    ...overrides,
  };
}

const budgets: AutonomousBudgets = {
  maxWallClockSeconds: 60,
  maxCommandCount: 5,
  maxRetryCount: 1,
  maxChangedFiles: 5,
  maxDiffLines: 100,
  maxValidationSeconds: 60,
};

describe("isApprovalRequired (M37-WU01, pure)", () => {
  it("is required for a medium-risk-requires-approval class regardless of policy", () => {
    expect(isApprovalRequired("medium_risk_requires_approval", [], "required_for_elevated")).toBe(true);
  });

  it("is required for a low-risk class when requestedPermissions is non-empty", () => {
    expect(isApprovalRequired("low_risk_autonomous", ["network"], "required_for_elevated")).toBe(true);
  });

  it("is NOT required for a low-risk class with no elevated permissions under required_for_elevated", () => {
    expect(isApprovalRequired("low_risk_autonomous", [], "required_for_elevated")).toBe(false);
  });

  it("is ALWAYS required under always_required, even for a low-risk class with no elevated permissions", () => {
    expect(isApprovalRequired("low_risk_autonomous", [], "always_required")).toBe(true);
  });
});

describe("computeApprovalBindingDigest / isApprovalStale (M37-WU01, pure)", () => {
  it("is deterministic: the same logical input always produces the same digest", () => {
    const input = { candidate: candidate(), baseCommit: "abc123", budgets };
    expect(computeApprovalBindingDigest(input)).toBe(computeApprovalBindingDigest(input));
  });

  it("is order-independent: key order in the input objects does not change the digest", () => {
    const a = { candidate: candidate(), baseCommit: "abc123", budgets };
    const b = { baseCommit: "abc123", budgets: { ...budgets }, candidate: candidate() };
    expect(computeApprovalBindingDigest(a)).toBe(computeApprovalBindingDigest(b));
  });

  it("changes when the candidate's objective changes", () => {
    const original = computeApprovalBindingDigest({ candidate: candidate(), baseCommit: "abc123", budgets });
    const changed = computeApprovalBindingDigest({ candidate: candidate({ objective: "fix something else" }), baseCommit: "abc123", budgets });
    expect(original).not.toBe(changed);
  });

  it("changes when the base commit changes", () => {
    const original = computeApprovalBindingDigest({ candidate: candidate(), baseCommit: "abc123", budgets });
    const changed = computeApprovalBindingDigest({ candidate: candidate(), baseCommit: "def456", budgets });
    expect(original).not.toBe(changed);
  });

  it("changes when budgets change", () => {
    const original = computeApprovalBindingDigest({ candidate: candidate(), baseCommit: "abc123", budgets });
    const changed = computeApprovalBindingDigest({ candidate: candidate(), baseCommit: "abc123", budgets: { ...budgets, maxCommandCount: 999 } });
    expect(original).not.toBe(changed);
  });

  it("isApprovalStale is false when the digest matches the current input", () => {
    const input = { candidate: candidate(), baseCommit: "abc123", budgets };
    const digest = computeApprovalBindingDigest(input);
    expect(isApprovalStale(digest, input)).toBe(false);
  });

  it("isApprovalStale is true once the candidate changes after approval was granted", () => {
    const input = { candidate: candidate(), baseCommit: "abc123", budgets };
    const digest = computeApprovalBindingDigest(input);
    const laterInput = { candidate: candidate({ objective: "a different objective now" }), baseCommit: "abc123", budgets };
    expect(isApprovalStale(digest, laterInput)).toBe(true);
  });
});
