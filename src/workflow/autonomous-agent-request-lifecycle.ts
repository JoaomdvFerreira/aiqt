import type { AutonomousAgentRequest, AutonomousAgentRequestStatus } from "../schema/autonomous-agent-request.schema.js";

/**
 * M37-WU02 (build spec: "cancellation"; reinterpreted per
 * docs/engineering/m37-wu02-agent-adapter-design-note.md as
 * request-lifecycle cancellation, since no live child process exists in
 * this Work Unit's chosen architecture). Fixed adjacency, mirrors the
 * M36-WU01 lifecycle-table pattern: `pending` is the only non-terminal
 * status; every other status is terminal.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<AutonomousAgentRequestStatus, ReadonlySet<AutonomousAgentRequestStatus>>> = {
  pending: new Set(["imported", "expired", "cancelled"]),
  imported: new Set(),
  expired: new Set(),
  cancelled: new Set(),
};

export function isValidAgentRequestTransition(from: AutonomousAgentRequestStatus, to: AutonomousAgentRequestStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function isTerminalAgentRequestStatus(status: AutonomousAgentRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[status].size === 0;
}

/** A request past its own expiresAt can never be imported, regardless of its persisted status -- evaluated live, never written back speculatively (mirrors M27's ExecutionAdapterRequestSchema comment: expiry is "evaluated live... rather than written back"). */
export function isAgentRequestExpired(request: Pick<AutonomousAgentRequest, "expiresAt">, now: Date = new Date()): boolean {
  return new Date(request.expiresAt).getTime() <= now.getTime();
}

export function cancelAgentRequest(request: AutonomousAgentRequest, now: Date = new Date()): { ok: true; request: AutonomousAgentRequest } | { ok: false; reason: string } {
  if (!isValidAgentRequestTransition(request.status, "cancelled")) {
    return { ok: false, reason: `Request ${request.requestId} is in status "${request.status}" and cannot be cancelled (it is already terminal).` };
  }
  return { ok: true, request: { ...request, status: "cancelled", cancelledAt: now.toISOString() } };
}
