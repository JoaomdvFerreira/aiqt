import type { SandboxNetworkPolicy } from "../schema/sandbox-backend.schema.js";

/**
 * M38-WU01 (build spec Sec 6 "Network policy": denied by default;
 * network requires explicit approval bound to candidate, provider,
 * destination policy, reason, duration, and budget; "If destination
 * controls cannot be enforced, network-enabled live execution is
 * unsupported"). Pure structural validation only -- this module never
 * opens a socket, never resolves a hostname, never configures a
 * firewall rule.
 */
export interface SandboxNetworkPolicyValidation {
  ok: boolean;
  issues: string[];
}

export function validateSandboxNetworkPolicy(policy: SandboxNetworkPolicy): SandboxNetworkPolicyValidation {
  const issues: string[] = [];

  if (policy.mode === "denied") {
    if (policy.approval !== null) {
      issues.push('mode is "denied" but an approval is present -- a denied policy must carry no approval.');
    }
    return { ok: issues.length === 0, issues };
  }

  // mode === "explicitly_enabled"
  if (policy.approval === null) {
    issues.push('mode is "explicitly_enabled" but no approval is present -- network access always requires an explicit, bound approval.');
    return { ok: false, issues };
  }

  if (policy.approval.destinationAllowlist.length === 0) {
    issues.push("approval has an empty destination allowlist -- destination controls cannot be enforced, so network-enabled live execution is unsupported.");
  }
  if (policy.approval.candidateId.trim() === "") {
    issues.push("approval is not bound to a candidate.");
  }
  if (policy.approval.provider.trim() === "") {
    issues.push("approval does not name a provider.");
  }
  if (policy.approval.reason.trim() === "") {
    issues.push("approval carries no reason.");
  }
  if (policy.approval.durationSeconds <= 0) {
    issues.push("approval duration must be positive.");
  }
  if (policy.approval.maxRequestCount <= 0) {
    issues.push("approval request budget must be positive.");
  }

  return { ok: issues.length === 0, issues };
}
