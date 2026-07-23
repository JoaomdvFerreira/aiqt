import type { ExecutionSession } from "../schema/execution-session.schema.js";
import { isTerminalSessionStatus } from "../schema/execution-session.schema.js";
import { isValidSessionStatusTransition } from "./execution-session-transitions.js";

/**
 * M26 §4.4: a non-terminal session with a configured `staleAfterSeconds`
 * becomes eligible once its stale deadline (lastActivityAt +
 * staleAfterSeconds) has passed -- strictly after the deadline, not at
 * it. A session with no configured staleAfterSeconds never becomes
 * eligible through this mechanism.
 */
export function computeStaleDeadline(session: ExecutionSession): string | null {
  const staleAfterSeconds = session.budgets?.staleAfterSeconds;
  if (staleAfterSeconds === undefined) return null;
  const lastActivityMs = Date.parse(session.lastActivityAt);
  if (Number.isNaN(lastActivityMs)) return null;
  return new Date(lastActivityMs + staleAfterSeconds * 1000).toISOString();
}

export function isStaleEligible(session: ExecutionSession, effectiveNow: string): boolean {
  if (isTerminalSessionStatus(session.status)) return false;
  if (session.status === "stale") return false;
  if (!isValidSessionStatusTransition(session.status, "stale")) return false;
  const deadline = computeStaleDeadline(session);
  if (deadline === null) return false;
  const deadlineMs = Date.parse(deadline);
  const nowMs = Date.parse(effectiveNow);
  if (Number.isNaN(deadlineMs) || Number.isNaN(nowMs)) return false;
  return nowMs > deadlineMs;
}

export interface StaleEligibility {
  sessionId: string;
  staleDeadline: string;
}

/** Read-only: which non-terminal sessions are eligible for a stale transition right now. Never mutates. */
export function findStaleEligibleSessions(sessions: readonly ExecutionSession[], effectiveNow: string): StaleEligibility[] {
  const eligible: StaleEligibility[] = [];
  for (const session of sessions) {
    if (isStaleEligible(session, effectiveNow)) {
      const deadline = computeStaleDeadline(session);
      if (deadline !== null) eligible.push({ sessionId: session.id, staleDeadline: deadline });
    }
  }
  return eligible;
}

export interface ApplyStaleResult {
  sessions: ExecutionSession[];
  transitionedSessionIds: string[];
}

/**
 * M26 §4.4: transitions every currently-eligible non-terminal session to
 * `stale`, recording the fixed reason "stale_timeout". Never cancels an
 * external provider, releases a workspace, or changes a Work Unit --
 * purely a canonical status transition plus a bounded record of it.
 */
export function applyStaleTransitions(sessions: readonly ExecutionSession[], effectiveNow: string): ApplyStaleResult {
  const transitionedSessionIds: string[] = [];
  const updated = sessions.map((session) => {
    if (!isStaleEligible(session, effectiveNow)) return session;
    transitionedSessionIds.push(session.id);
    return {
      ...session,
      status: "stale" as const,
      statusTransitions: [
        ...session.statusTransitions,
        { fromStatus: session.status, toStatus: "stale" as const, reason: "stale_timeout", at: effectiveNow },
      ],
      updatedAt: effectiveNow,
    };
  });
  return { sessions: updated, transitionedSessionIds };
}
