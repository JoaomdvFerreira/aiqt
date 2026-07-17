import { describe, it, expect } from "vitest";
import { resolveDirectPushBase, GIT_ZERO_SHA } from "../../src/tooling/push-base.js";

const ALWAYS_RESOLVES = () => true;
const NEVER_RESOLVES = () => false;

describe("resolveDirectPushBase (M19-RC1 §12/§17.3)", () => {
  it("compares against a valid, resolvable before SHA", () => {
    const result = resolveDirectPushBase("abc123", ALWAYS_RESOLVES);
    expect(result.action).toBe("compare");
    expect(result.base).toBe("abc123");
  });

  it("skips (does not error) for the all-zero SHA GitHub sends on a branch's first push", () => {
    const result = resolveDirectPushBase(GIT_ZERO_SHA, ALWAYS_RESOLVES);
    expect(result.action).toBe("skip-initial");
    expect(result.base).toBeUndefined();
  });

  it("skips for a missing (undefined) before value", () => {
    const result = resolveDirectPushBase(undefined, ALWAYS_RESOLVES);
    expect(result.action).toBe("skip-initial");
  });

  it("skips for an empty-string before value", () => {
    const result = resolveDirectPushBase("", ALWAYS_RESOLVES);
    expect(result.action).toBe("skip-initial");
  });

  it("skips for a whitespace-only before value", () => {
    const result = resolveDirectPushBase("   ", ALWAYS_RESOLVES);
    expect(result.action).toBe("skip-initial");
  });

  it("errors structurally when a non-empty, non-zero before SHA does not resolve", () => {
    const result = resolveDirectPushBase("deadbeef", NEVER_RESOLVES);
    expect(result.action).toBe("error-unresolvable");
    expect(result.reason).toContain("deadbeef");
  });

  it("trims surrounding whitespace before checking resolvability", () => {
    let checkedWith: string | null = null;
    const result = resolveDirectPushBase("  abc123  ", (sha) => {
      checkedWith = sha;
      return true;
    });
    expect(checkedWith).toBe("abc123");
    expect(result.base).toBe("abc123");
  });

  it("never calls the resolver for the all-zero SHA (short-circuits before any git call)", () => {
    let called = false;
    resolveDirectPushBase(GIT_ZERO_SHA, () => {
      called = true;
      return true;
    });
    expect(called).toBe(false);
  });
});
