import type { StateModel } from "../schema/state.schema.js";
import type { ExecutionAdapterRequest } from "../schema/execution-adapter-request.schema.js";

/** M27 §3.1: additive/optional state collection, empty by default on pre-M27 state. */
export function getExecutionAdapterRequests(state: StateModel): ExecutionAdapterRequest[] {
  return state.executionAdapterRequests ?? [];
}

export function findAdapterRequestById(
  requestId: string,
  requests: readonly ExecutionAdapterRequest[],
): ExecutionAdapterRequest | undefined {
  return requests.find((r) => r.id === requestId);
}

export function findAdapterRequestsForSession(
  executionSessionId: string,
  requests: readonly ExecutionAdapterRequest[],
): ExecutionAdapterRequest[] {
  return requests.filter((r) => r.executionSessionId === executionSessionId);
}

/**
 * M27 §3.1: "one session has at most one active `requested` record" --
 * `expired` is a live/derived judgment (see execution-adapter-request.schema.ts's
 * status-field comment), so a `requested` record whose `expiresAt` has
 * already passed as of `effectiveNow` is not active and does not block a
 * new request.
 */
export function isAdapterRequestExpired(request: ExecutionAdapterRequest, effectiveNow: string): boolean {
  const expiresMs = Date.parse(request.expiresAt);
  const nowMs = Date.parse(effectiveNow);
  if (Number.isNaN(expiresMs) || Number.isNaN(nowMs)) return false;
  return nowMs > expiresMs;
}

export function findActiveAdapterRequestForSession(
  executionSessionId: string,
  requests: readonly ExecutionAdapterRequest[],
  effectiveNow: string,
): ExecutionAdapterRequest | undefined {
  return requests.find(
    (r) => r.executionSessionId === executionSessionId && r.status === "requested" && !isAdapterRequestExpired(r, effectiveNow),
  );
}

export function maxRequestSequenceForSession(
  executionSessionId: string,
  requests: readonly ExecutionAdapterRequest[],
): number {
  return requests
    .filter((r) => r.executionSessionId === executionSessionId)
    .reduce((max, r) => Math.max(max, r.requestSequence), 0);
}
