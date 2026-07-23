import type { ExecutionSessionStatus } from "../schema/execution-session.schema.js";

/**
 * M26 §4.1: the exact allowed transition table. Terminal statuses
 * (failed/completed/cancelled) allow no further transition. `stale ->
 * completed` is explicitly prohibited (a stale session must first return
 * to running/paused/blocked before it can complete). `planned -> failed`
 * represents a provider-side failure before the first iteration ever
 * starts; `cancelled` is reserved for deliberate cancellation.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ExecutionSessionStatus, ReadonlySet<ExecutionSessionStatus>>> = {
  planned: new Set(["running", "failed", "cancelled", "stale"]),
  running: new Set(["paused", "blocked", "failed", "completed", "cancelled", "stale"]),
  paused: new Set(["running", "blocked", "failed", "cancelled", "stale"]),
  blocked: new Set(["running", "paused", "failed", "cancelled", "stale"]),
  stale: new Set(["running", "paused", "blocked", "failed", "cancelled"]),
  failed: new Set(),
  completed: new Set(),
  cancelled: new Set(),
};

export function isValidSessionStatusTransition(
  from: ExecutionSessionStatus,
  to: ExecutionSessionStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].has(to);
}
