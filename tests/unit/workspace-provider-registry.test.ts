import { describe, it, expect } from "vitest";
import {
  SUPPORTED_WORKSPACE_PROVIDERS,
  isSupportedWorkspaceProviderId,
  resolveProviderForWorkspaceMode,
} from "../../src/workspaces/workspace-provider-registry.js";

describe("workspace provider registry (M25 §2)", () => {
  it("contains exactly the two static providers", () => {
    expect([...SUPPORTED_WORKSPACE_PROVIDERS].sort()).toEqual(["git-worktree@1", "shared-repository@1"]);
  });

  it("maps shared -> shared-repository@1", () => {
    expect(resolveProviderForWorkspaceMode("shared")).toBe("shared-repository@1");
  });

  it("maps isolated -> git-worktree@1", () => {
    expect(resolveProviderForWorkspaceMode("isolated")).toBe("git-worktree@1");
  });

  it("maps none -> no_provider", () => {
    expect(resolveProviderForWorkspaceMode("none")).toBe("no_provider");
  });

  it("rejects an unknown provider id", () => {
    expect(isSupportedWorkspaceProviderId("custom-provider@1")).toBe(false);
    expect(isSupportedWorkspaceProviderId(123)).toBe(false);
  });

  it("accepts each of the two known provider ids", () => {
    expect(isSupportedWorkspaceProviderId("shared-repository@1")).toBe(true);
    expect(isSupportedWorkspaceProviderId("git-worktree@1")).toBe(true);
  });
});
