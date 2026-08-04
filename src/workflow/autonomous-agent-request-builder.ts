import { createHash } from "node:crypto";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousExecutionPolicy } from "../schema/autonomous-run.schema.js";
import {
  AUTONOMOUS_AGENT_PROVIDER_ID,
  AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS,
  type AutonomousAgentRequest,
  type AutonomousAgentPromptPackage,
} from "../schema/autonomous-agent-request.schema.js";

/**
 * M37-WU02 (build spec: "bounded prompt/context"; "minimal environment
 * projection"; "wall-clock and command budgets"). Pure -- no I/O, no
 * process spawn, no network. Builds the request package AIQT hands to
 * the operator; never itself runs anything with it.
 */

/** Deep, key-sorted canonicalization -- mirrors autonomous-run-approval.ts's own canonicalize(), so two logically-identical requests always digest identically regardless of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = canonicalize(obj[key]);
    return out;
  }
  return value;
}

export function computeAgentRequestDigest(input: { runId: string; candidate: AutonomousCandidate; promptPackage: AutonomousAgentPromptPackage; budgets: AutonomousBudgets }): string {
  const hash = createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
  return `sha256:${hash}`;
}

function buildPromptPackage(candidate: AutonomousCandidate): AutonomousAgentPromptPackage {
  return {
    objective: candidate.objective,
    acceptanceCriteria: candidate.acceptanceCriteria,
    constraints: candidate.constraints,
    instructions:
      "Propose the minimal set of commands (as {command, args}) needed to satisfy the objective and acceptance criteria above, respecting every listed constraint. Do not merge, push, or deploy anything -- a human reviews and integrates your proposal separately. Report your proposed commands in the response file this request package describes.",
  };
}

export interface BuildAutonomousAgentRequestParams {
  requestId: string;
  runId: string;
  candidate: AutonomousCandidate;
  budgets: AutonomousBudgets;
  policy: AutonomousExecutionPolicy;
  /**
   * Explicit, operator-supplied allowlist of environment variable NAMES
   * (never values) safe to expose to their own tool -- build spec Sec
   * 6.7: "Environment projection must be explicit and minimal." Defaults
   * to empty: nothing is assumed safe unless the operator says so.
   */
  environmentProjection?: readonly string[];
  now?: Date;
}

export function buildAutonomousAgentRequest(params: BuildAutonomousAgentRequestParams): AutonomousAgentRequest {
  const now = params.now ?? new Date();
  const promptPackage = buildPromptPackage(params.candidate);
  const requestDigest = computeAgentRequestDigest({ runId: params.runId, candidate: params.candidate, promptPackage, budgets: params.budgets });

  return {
    requestId: params.requestId,
    runId: params.runId,
    providerId: AUTONOMOUS_AGENT_PROVIDER_ID,
    status: "pending",
    candidate: params.candidate,
    promptPackage,
    budgets: params.budgets,
    policy: params.policy,
    allowedCommandClasses: params.policy.allowedCommandClasses,
    environmentProjection: [...(params.environmentProjection ?? [])],
    requestDigest,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS * 1000).toISOString(),
  };
}
