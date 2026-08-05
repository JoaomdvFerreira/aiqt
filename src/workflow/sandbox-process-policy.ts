import type { SandboxProcessPolicy } from "../schema/sandbox-backend.schema.js";

/**
 * M38-WU01 (build spec Sec 6 "Process policy": "The sandbox must own
 * the complete process tree and support: graceful stop; forced
 * termination; orphan detection; process-count limit; cleanup
 * verification"). Pure structural validation only -- no process is
 * inspected, stopped, or owned by this module; that is WU38-03 scope.
 */
const MAX_REASONABLE_PROCESS_COUNT_LIMIT = 10_000;
const MAX_REASONABLE_TIMEOUT_SECONDS = 3_600;

export interface SandboxProcessPolicyValidation {
  ok: boolean;
  issues: string[];
}

export function validateSandboxProcessPolicy(policy: SandboxProcessPolicy): SandboxProcessPolicyValidation {
  const issues: string[] = [];

  if (!Number.isFinite(policy.processCountLimit) || policy.processCountLimit <= 0) {
    issues.push(`processCountLimit must be a positive, finite number (got ${policy.processCountLimit}).`);
  } else if (policy.processCountLimit > MAX_REASONABLE_PROCESS_COUNT_LIMIT) {
    issues.push(`processCountLimit (${policy.processCountLimit}) exceeds the reasonable ceiling of ${MAX_REASONABLE_PROCESS_COUNT_LIMIT}.`);
  }

  if (!Number.isFinite(policy.gracefulStopTimeoutSeconds) || policy.gracefulStopTimeoutSeconds <= 0) {
    issues.push(`gracefulStopTimeoutSeconds must be a positive, finite number (got ${policy.gracefulStopTimeoutSeconds}).`);
  } else if (policy.gracefulStopTimeoutSeconds > MAX_REASONABLE_TIMEOUT_SECONDS) {
    issues.push(`gracefulStopTimeoutSeconds (${policy.gracefulStopTimeoutSeconds}) exceeds the reasonable ceiling of ${MAX_REASONABLE_TIMEOUT_SECONDS}.`);
  }

  if (!Number.isFinite(policy.forceTerminationTimeoutSeconds) || policy.forceTerminationTimeoutSeconds <= 0) {
    issues.push(`forceTerminationTimeoutSeconds must be a positive, finite number (got ${policy.forceTerminationTimeoutSeconds}).`);
  } else if (policy.forceTerminationTimeoutSeconds > MAX_REASONABLE_TIMEOUT_SECONDS) {
    issues.push(`forceTerminationTimeoutSeconds (${policy.forceTerminationTimeoutSeconds}) exceeds the reasonable ceiling of ${MAX_REASONABLE_TIMEOUT_SECONDS}.`);
  }

  if (
    Number.isFinite(policy.gracefulStopTimeoutSeconds) &&
    Number.isFinite(policy.forceTerminationTimeoutSeconds) &&
    policy.forceTerminationTimeoutSeconds < policy.gracefulStopTimeoutSeconds
  ) {
    issues.push("forceTerminationTimeoutSeconds must not be shorter than gracefulStopTimeoutSeconds -- forced termination is the escalation, not the first attempt.");
  }

  return { ok: issues.length === 0, issues };
}
