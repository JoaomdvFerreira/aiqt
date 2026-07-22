import { describe, it, expect } from "vitest";
import { deriveBranchName, isValidAiqtBranchShape } from "../../src/workspaces/workspace-branch-policy.js";

describe("deriveBranchName (M25 §7)", () => {
  it("is deterministic for the same inputs", () => {
    const a = deriveBranchName("P001", "WU001", "abcdef0123456789");
    const b = deriveBranchName("P001", "WU001", "abcdef0123456789");
    expect(a).toBe(b);
  });

  it("uses the aiqt/<project>/<work-unit>-<hash> template", () => {
    const branch = deriveBranchName("P001", "WU001", "abcdef0123456789");
    expect(branch).toBe("aiqt/p001/wu001-abcdef012345");
  });

  it("sanitizes invalid characters to a lowercase ASCII subset", () => {
    const branch = deriveBranchName("Proj Name!", "WU 001", "abcdef0123456789");
    expect(branch.startsWith("aiqt/proj-name/wu-001-")).toBe(true);
  });

  it("collapses repeated separators", () => {
    const branch = deriveBranchName("proj---name", "wu___001", "abcdef0123456789");
    expect(branch).toBe("aiqt/proj-name/wu-001-abcdef012345");
  });

  it("stays within the 180-character branch-name cap even for long inputs", () => {
    const branch = deriveBranchName("p".repeat(300), "w".repeat(300), "abcdef0123456789");
    expect(branch.length).toBeLessThanOrEqual(180);
  });

  it("passes its own structural shape validator", () => {
    const branch = deriveBranchName("P001", "WU001", "abcdef0123456789");
    expect(isValidAiqtBranchShape(branch)).toBe(true);
  });
});

describe("isValidAiqtBranchShape (M25 §7/§25.4)", () => {
  it("rejects a branch not under the aiqt/ prefix", () => {
    expect(isValidAiqtBranchShape("feature/foo")).toBe(false);
  });

  it("rejects a branch with too many or too few path segments", () => {
    expect(isValidAiqtBranchShape("aiqt/only-one")).toBe(false);
    expect(isValidAiqtBranchShape("aiqt/a/b/c")).toBe(false);
  });

  it("rejects uppercase or invalid characters", () => {
    expect(isValidAiqtBranchShape("aiqt/Proj/WU001")).toBe(false);
    expect(isValidAiqtBranchShape("aiqt/proj/wu 001")).toBe(false);
  });

  it("rejects an oversized branch name", () => {
    expect(isValidAiqtBranchShape(`aiqt/${"a".repeat(200)}/x`)).toBe(false);
  });
});
