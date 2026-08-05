import { describe, it, expect } from "vitest";
import { validateSandboxResourcePolicy } from "../../src/workflow/sandbox-resource-policy.js";
import type { SandboxResourcePolicy } from "../../src/schema/sandbox-backend.schema.js";

function policy(overrides: Partial<SandboxResourcePolicy> = {}): SandboxResourcePolicy {
  return {
    maxWallClockSeconds: 600,
    maxCpuSeconds: 600,
    maxMemoryBytes: 512 * 1024 * 1024,
    maxDiskWriteBytes: 100 * 1024 * 1024,
    maxProcessCount: 32,
    maxCommandCount: 20,
    maxOutputBytes: 1024 * 1024,
    maxRetryCount: 3,
    ...overrides,
  };
}

describe("M38-WU01 sandbox-resource-policy: resource validation", () => {
  it("accepts a well-formed policy", () => {
    expect(validateSandboxResourcePolicy(policy()).ok).toBe(true);
  });

  it.each([
    "maxWallClockSeconds",
    "maxCpuSeconds",
    "maxMemoryBytes",
    "maxDiskWriteBytes",
    "maxProcessCount",
    "maxCommandCount",
    "maxOutputBytes",
  ] as const)("rejects a non-positive %s", (field) => {
    expect(validateSandboxResourcePolicy(policy({ [field]: 0 })).ok).toBe(false);
    expect(validateSandboxResourcePolicy(policy({ [field]: -5 })).ok).toBe(false);
  });

  it("accepts maxRetryCount of exactly 0 (non-negative, not strictly positive)", () => {
    expect(validateSandboxResourcePolicy(policy({ maxRetryCount: 0 })).ok).toBe(true);
  });

  it("rejects a negative maxRetryCount", () => {
    expect(validateSandboxResourcePolicy(policy({ maxRetryCount: -1 })).ok).toBe(false);
  });

  it("rejects a non-finite value", () => {
    expect(validateSandboxResourcePolicy(policy({ maxMemoryBytes: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(validateSandboxResourcePolicy(policy({ maxMemoryBytes: Number.NaN })).ok).toBe(false);
  });

  it("rejects limits beyond the reasonable ceiling", () => {
    expect(validateSandboxResourcePolicy(policy({ maxWallClockSeconds: 25 * 60 * 60 })).ok).toBe(false);
    expect(validateSandboxResourcePolicy(policy({ maxProcessCount: 1_000_000 })).ok).toBe(false);
    expect(validateSandboxResourcePolicy(policy({ maxCommandCount: 1_000_000 })).ok).toBe(false);
    expect(validateSandboxResourcePolicy(policy({ maxRetryCount: 100_000 })).ok).toBe(false);
  });
});
