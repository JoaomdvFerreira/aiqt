import { describe, it, expect } from "vitest";
import { validateSandboxProcessPolicy } from "../../src/workflow/sandbox-process-policy.js";
import type { SandboxProcessPolicy } from "../../src/schema/sandbox-backend.schema.js";

function policy(overrides: Partial<SandboxProcessPolicy> = {}): SandboxProcessPolicy {
  return { processCountLimit: 32, gracefulStopTimeoutSeconds: 10, forceTerminationTimeoutSeconds: 30, ...overrides };
}

describe("M38-WU01 sandbox-process-policy: invalid policy rejection", () => {
  it("accepts a well-formed policy", () => {
    expect(validateSandboxProcessPolicy(policy()).ok).toBe(true);
  });

  it("rejects a non-positive processCountLimit", () => {
    expect(validateSandboxProcessPolicy(policy({ processCountLimit: 0 })).ok).toBe(false);
    expect(validateSandboxProcessPolicy(policy({ processCountLimit: -1 })).ok).toBe(false);
  });

  it("rejects a processCountLimit beyond the reasonable ceiling", () => {
    expect(validateSandboxProcessPolicy(policy({ processCountLimit: 1_000_000 })).ok).toBe(false);
  });

  it("rejects non-positive timeouts", () => {
    expect(validateSandboxProcessPolicy(policy({ gracefulStopTimeoutSeconds: 0 })).ok).toBe(false);
    expect(validateSandboxProcessPolicy(policy({ forceTerminationTimeoutSeconds: 0 })).ok).toBe(false);
  });

  it("rejects forced termination timeout shorter than the graceful stop timeout", () => {
    const result = validateSandboxProcessPolicy(policy({ gracefulStopTimeoutSeconds: 30, forceTerminationTimeoutSeconds: 10 }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("escalation"))).toBe(true);
  });

  it("accepts equal graceful/forced timeouts (no escalation window is still valid)", () => {
    expect(validateSandboxProcessPolicy(policy({ gracefulStopTimeoutSeconds: 10, forceTerminationTimeoutSeconds: 10 })).ok).toBe(true);
  });
});
