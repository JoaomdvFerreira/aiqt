import { createHash } from "node:crypto";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousRiskClass } from "../schema/autonomous-run.schema.js";
import { RISK_CLASSES_REQUIRING_APPROVAL } from "../schema/autonomous-run.schema.js";
import type { AutonomousApprovalPolicy } from "../schema/autonomous-run-operator.schema.js";

/**
 * M37-WU01 (build spec Sec 6.3 "Approval"). Approval is mandatory for:
 * medium-risk candidates; a candidate that requests any elevated
 * permission; or whenever the operator's own configured approvalPolicy
 * says so unconditionally ("always_required"). Low-risk unattended
 * execution is allowed only when policy explicitly enables it
 * ("required_for_elevated" -- approval only for what actually needs it).
 * Always-blocked risk classes never reach this function in practice
 * (classify() stops them before approval is ever considered) -- this
 * function does not special-case them, since "requires approval" is a
 * meaningless question for a candidate that can never proceed at all.
 */
export function isApprovalRequired(riskClass: AutonomousRiskClass, requestedPermissions: readonly string[], approvalPolicy: AutonomousApprovalPolicy): boolean {
  if (approvalPolicy === "always_required") return true;
  if (RISK_CLASSES_REQUIRING_APPROVAL.has(riskClass)) return true;
  if (requestedPermissions.length > 0) return true;
  return false;
}

export interface ApprovalBindingInput {
  candidate: AutonomousCandidate;
  baseCommit: string;
  budgets: AutonomousBudgets;
}

/** Deep, key-sorted canonicalization so two logically-identical inputs always serialize identically regardless of original key order. */
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

/**
 * A sha256 hex digest binding an approval to the exact candidate,
 * base commit, and budgets it was granted for (build spec: "approval
 * bound to candidate, base commit, budgets, and permissions" --
 * `requestedPermissions` is itself a field of `candidate`, so binding to
 * the whole candidate object already covers it without a separate
 * parameter). Deterministic and order-independent: the same logical
 * input always produces the same digest.
 */
export function computeApprovalBindingDigest(input: ApprovalBindingInput): string {
  const canonical = canonicalize(input);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** True when the currently-recorded approval no longer matches what would be run -- the candidate, base commit, or budgets changed since approval was granted. A stale approval must never authorize a run. */
export function isApprovalStale(recordedBindingDigest: string, currentInput: ApprovalBindingInput): boolean {
  return computeApprovalBindingDigest(currentInput) !== recordedBindingDigest;
}
