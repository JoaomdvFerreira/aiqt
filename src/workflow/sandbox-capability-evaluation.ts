import { MINIMUM_REQUIRED_SANDBOX_CAPABILITIES, type SandboxCapability, type SandboxCapabilityReport } from "../schema/sandbox-backend.schema.js";
import { buildSandboxFallbackRecommendation, type SandboxFallbackRecommendation } from "./sandbox-fallback-policy.js";

/**
 * M38-WU01 (build spec Sec 6 "Capability model": "Insufficient
 * capabilities must return blocked and recommend request/import"). Pure
 * evaluation over a capability report a backend claims to have -- this
 * function never queries a real backend (no backend implementation
 * exists in this repository yet) and never launches anything.
 */
export interface SandboxCapabilityEvaluation {
  sufficient: boolean;
  missingCapabilities: SandboxCapability[];
  recommendation: "proceed_to_sandbox_creation" | SandboxFallbackRecommendation["recommendation"];
  fallback: SandboxFallbackRecommendation | null;
}

export function evaluateSandboxCapabilities(report: SandboxCapabilityReport): SandboxCapabilityEvaluation {
  const reported = new Set(report.capabilities);
  const missingCapabilities = [...MINIMUM_REQUIRED_SANDBOX_CAPABILITIES].filter((c) => !reported.has(c));

  if (missingCapabilities.length === 0) {
    return { sufficient: true, missingCapabilities: [], recommendation: "proceed_to_sandbox_creation", fallback: null };
  }

  const fallback = buildSandboxFallbackRecommendation(
    `Backend "${report.backendId}" is missing required capabilities: ${missingCapabilities.join(", ")}.`,
  );
  return { sufficient: false, missingCapabilities, recommendation: fallback.recommendation, fallback };
}

/**
 * Network-enabled runs additionally require `network_destination_restriction`
 * (build spec Sec 6 "Network policy": "If destination controls cannot be
 * enforced, network-enabled live execution is unsupported"). Callers
 * should call this in addition to `evaluateSandboxCapabilities` only when
 * the run's own network policy requests `explicitly_enabled`; a
 * network-denied run never needs this check.
 */
export function evaluateSandboxNetworkCapability(report: SandboxCapabilityReport): SandboxCapabilityEvaluation {
  const reported = new Set(report.capabilities);
  if (reported.has("network_destination_restriction")) {
    return { sufficient: true, missingCapabilities: [], recommendation: "proceed_to_sandbox_creation", fallback: null };
  }
  const fallback = buildSandboxFallbackRecommendation(
    `Backend "${report.backendId}" cannot enforce network destination restrictions -- network-enabled live execution is unsupported.`,
  );
  return { sufficient: false, missingCapabilities: ["network_destination_restriction"], recommendation: fallback.recommendation, fallback };
}
