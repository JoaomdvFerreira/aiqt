import type { SandboxResourcePolicy } from "../schema/sandbox-backend.schema.js";

/**
 * M38-WU01 (build spec Sec 6 "Resource policy": wall clock, CPU, memory,
 * disk writes, process count, command count, output size, retries).
 * Pure structural validation -- no resource is ever actually enforced by
 * this module (that is WU38-02/03 scope); this only rejects a policy
 * that could never be enforced (non-positive, non-finite, or absurdly
 * large limits).
 */
const MAX_REASONABLE_WALL_CLOCK_SECONDS = 24 * 60 * 60; // 24 hours -- mirrors the M37 agent-request expiry order of magnitude
const MAX_REASONABLE_PROCESS_COUNT = 10_000;
const MAX_REASONABLE_COMMAND_COUNT = 10_000;
const MAX_REASONABLE_RETRY_COUNT = 1_000;

export interface SandboxResourcePolicyValidation {
  ok: boolean;
  issues: string[];
}

function checkPositiveFinite(value: number, label: string, issues: string[]): void {
  if (!Number.isFinite(value) || value <= 0) {
    issues.push(`${label} must be a positive, finite number (got ${value}).`);
  }
}

export function validateSandboxResourcePolicy(policy: SandboxResourcePolicy): SandboxResourcePolicyValidation {
  const issues: string[] = [];

  checkPositiveFinite(policy.maxWallClockSeconds, "maxWallClockSeconds", issues);
  checkPositiveFinite(policy.maxCpuSeconds, "maxCpuSeconds", issues);
  checkPositiveFinite(policy.maxMemoryBytes, "maxMemoryBytes", issues);
  checkPositiveFinite(policy.maxDiskWriteBytes, "maxDiskWriteBytes", issues);
  checkPositiveFinite(policy.maxProcessCount, "maxProcessCount", issues);
  checkPositiveFinite(policy.maxCommandCount, "maxCommandCount", issues);
  checkPositiveFinite(policy.maxOutputBytes, "maxOutputBytes", issues);

  if (!Number.isFinite(policy.maxRetryCount) || policy.maxRetryCount < 0) {
    issues.push(`maxRetryCount must be a non-negative, finite number (got ${policy.maxRetryCount}).`);
  }

  if (policy.maxWallClockSeconds > MAX_REASONABLE_WALL_CLOCK_SECONDS) {
    issues.push(`maxWallClockSeconds (${policy.maxWallClockSeconds}) exceeds the reasonable ceiling of ${MAX_REASONABLE_WALL_CLOCK_SECONDS} (24 hours).`);
  }
  if (policy.maxProcessCount > MAX_REASONABLE_PROCESS_COUNT) {
    issues.push(`maxProcessCount (${policy.maxProcessCount}) exceeds the reasonable ceiling of ${MAX_REASONABLE_PROCESS_COUNT}.`);
  }
  if (policy.maxCommandCount > MAX_REASONABLE_COMMAND_COUNT) {
    issues.push(`maxCommandCount (${policy.maxCommandCount}) exceeds the reasonable ceiling of ${MAX_REASONABLE_COMMAND_COUNT}.`);
  }
  if (policy.maxRetryCount > MAX_REASONABLE_RETRY_COUNT) {
    issues.push(`maxRetryCount (${policy.maxRetryCount}) exceeds the reasonable ceiling of ${MAX_REASONABLE_RETRY_COUNT}.`);
  }

  return { ok: issues.length === 0, issues };
}
