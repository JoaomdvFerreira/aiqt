import { describe, it, expect } from "vitest";
import { validateSandboxNetworkPolicy } from "../../src/workflow/sandbox-network-policy.js";
import { DEFAULT_SANDBOX_NETWORK_POLICY, type SandboxNetworkApproval } from "../../src/schema/sandbox-backend.schema.js";

function approval(overrides: Partial<SandboxNetworkApproval> = {}): SandboxNetworkApproval {
  return {
    candidateId: "run-1",
    provider: "external-coding-agent-manual@1",
    destinationAllowlist: ["registry.npmjs.org"],
    reason: "install a dependency",
    durationSeconds: 300,
    maxRequestCount: 10,
    ...overrides,
  };
}

describe("M38-WU01 sandbox-network-policy: network-denied default", () => {
  it("the default policy (denied, no approval) is valid", () => {
    const result = validateSandboxNetworkPolicy(DEFAULT_SANDBOX_NETWORK_POLICY);
    expect(result.ok).toBe(true);
  });

  it("rejects a denied policy that nonetheless carries an approval (inconsistent state)", () => {
    const result = validateSandboxNetworkPolicy({ mode: "denied", approval: approval() });
    expect(result.ok).toBe(false);
  });
});

describe("M38-WU01 sandbox-network-policy: invalid policy rejection", () => {
  it("rejects an explicitly_enabled policy with no approval at all", () => {
    const result = validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: null });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("no approval"))).toBe(true);
  });

  it("accepts a fully-bound explicitly_enabled policy", () => {
    const result = validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: approval() });
    expect(result.ok).toBe(true);
  });

  it("rejects an approval with an empty destination allowlist -- destination controls cannot be enforced", () => {
    const result = validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: approval({ destinationAllowlist: [] }) });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("destination"))).toBe(true);
  });

  it("rejects an approval missing a candidate, provider, or reason", () => {
    expect(validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: approval({ candidateId: "" }) }).ok).toBe(false);
    expect(validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: approval({ provider: "" }) }).ok).toBe(false);
    expect(validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: approval({ reason: "" }) }).ok).toBe(false);
  });

  it("rejects a non-positive duration or request budget", () => {
    expect(validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: approval({ durationSeconds: 0 }) }).ok).toBe(false);
    expect(validateSandboxNetworkPolicy({ mode: "explicitly_enabled", approval: approval({ maxRequestCount: 0 }) }).ok).toBe(false);
  });
});
