import { describe, it, expect } from "vitest";
import { decideSandboxPlatformSupport, normalizeSandboxHostPlatform } from "../../src/workflow/sandbox-platform-decision.js";

describe("M38-WU01 sandbox-platform-decision", () => {
  it("normalizes known platform strings and falls back to 'other' for anything unrecognized", () => {
    expect(normalizeSandboxHostPlatform("linux")).toBe("linux");
    expect(normalizeSandboxHostPlatform("darwin")).toBe("darwin");
    expect(normalizeSandboxHostPlatform("win32")).toBe("win32");
    expect(normalizeSandboxHostPlatform("freebsd")).toBe("other");
    expect(normalizeSandboxHostPlatform("")).toBe("other");
  });

  it("linux is supported, via the oci-container backend", () => {
    const decision = decideSandboxPlatformSupport("linux");
    expect(decision.supportStatus).toBe("supported");
    expect(decision.backendId).toBe("oci-container@1");
    expect(decision.isolationPrimitive).toBe("oci_container");
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("win32 fails closed: unsupported, no backend, no isolation primitive", () => {
    const decision = decideSandboxPlatformSupport("win32");
    expect(decision.supportStatus).toBe("unsupported");
    expect(decision.backendId).toBeNull();
    expect(decision.isolationPrimitive).toBe("none");
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("darwin fails closed: unsupported, no backend, no isolation primitive", () => {
    const decision = decideSandboxPlatformSupport("darwin");
    expect(decision.supportStatus).toBe("unsupported");
    expect(decision.backendId).toBeNull();
  });

  it("an unrecognized platform string fails closed rather than defaulting to supported", () => {
    const decision = decideSandboxPlatformSupport("aix");
    expect(decision.supportStatus).toBe("unsupported");
    expect(decision.platform).toBe("other");
    expect(decision.backendId).toBeNull();
  });
});
