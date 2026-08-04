import { describe, expect, it } from "vitest";
import { deriveAutonomousRunBranchName, isValidAutonomousRunBranchShape } from "../../src/workflow/autonomous-run-branch-policy.js";

describe("M36-WU03: deriveAutonomousRunBranchName", () => {
  it("produces a deterministic autonomous/<issue>-<run> branch name", () => {
    const branch = deriveAutonomousRunBranchName("ISSUE-1", "run-42");
    expect(branch).toBe("autonomous/issue-1-run-42");
  });

  it("is deterministic: the same inputs always produce the same branch name", () => {
    expect(deriveAutonomousRunBranchName("ISSUE-1", "run-42")).toBe(deriveAutonomousRunBranchName("ISSUE-1", "run-42"));
  });

  it("sanitizes non-alphanumeric characters in both tokens", () => {
    const branch = deriveAutonomousRunBranchName("Issue #1: fix bug!", "run/42:special");
    expect(branch).toMatch(/^autonomous\/[a-z0-9-]+$/);
  });

  it("two different issue ids never collide, and two different run ids for the same issue never collide", () => {
    const a = deriveAutonomousRunBranchName("ISSUE-1", "run-1");
    const b = deriveAutonomousRunBranchName("ISSUE-2", "run-1");
    const c = deriveAutonomousRunBranchName("ISSUE-1", "run-2");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("truncates an overlong issue token to respect the 180-character branch-name cap while preserving the full run token", () => {
    const longIssueId = "x".repeat(300);
    const branch = deriveAutonomousRunBranchName(longIssueId, "run-42");
    expect(branch.length).toBeLessThanOrEqual(180);
    expect(branch.endsWith("-run-42")).toBe(true);
  });

  it("every derived branch name passes isValidAutonomousRunBranchShape", () => {
    expect(isValidAutonomousRunBranchShape(deriveAutonomousRunBranchName("ISSUE-1", "run-1"))).toBe(true);
    expect(isValidAutonomousRunBranchShape(deriveAutonomousRunBranchName("x".repeat(300), "run-1"))).toBe(true);
  });
});

describe("M36-WU03: isValidAutonomousRunBranchShape", () => {
  it("rejects a branch name without the autonomous/ prefix", () => {
    expect(isValidAutonomousRunBranchShape("aiqt/some/branch")).toBe(false);
    expect(isValidAutonomousRunBranchShape("main")).toBe(false);
  });

  it("rejects an empty suffix after the prefix", () => {
    expect(isValidAutonomousRunBranchShape("autonomous/")).toBe(false);
  });

  it("rejects uppercase or invalid characters", () => {
    expect(isValidAutonomousRunBranchShape("autonomous/ISSUE-1")).toBe(false);
    expect(isValidAutonomousRunBranchShape("autonomous/issue_1")).toBe(false);
  });

  it("rejects a branch name exceeding the 180-character cap", () => {
    expect(isValidAutonomousRunBranchShape(`autonomous/${"a".repeat(200)}`)).toBe(false);
  });
});
