import type { StateModel } from "../schema/state.schema.js";
import type { ExecutionSession } from "../schema/execution-session.schema.js";
import { isTerminalSessionStatus } from "../schema/execution-session.schema.js";

/** M26 §3: missing state.executionSessions must be treated as an empty collection. */
export function getExecutionSessions(state: StateModel): ExecutionSession[] {
  return state.executionSessions ?? [];
}

export function findExecutionSessionById(
  sessionId: string,
  sessions: readonly ExecutionSession[],
): ExecutionSession | undefined {
  return sessions.find((s) => s.id === sessionId);
}

export function findSessionsForWorkUnit(
  workUnitId: string,
  sessions: readonly ExecutionSession[],
): ExecutionSession[] {
  return sessions.filter((s) => s.workUnitId === workUnitId);
}

export function findSessionsForPacket(
  packetId: string,
  sessions: readonly ExecutionSession[],
): ExecutionSession[] {
  return sessions.filter((s) => s.packetId === packetId);
}

/** M26 §3.1: at most one non-terminal session per packet is ever valid canonical state. */
export function findNonTerminalSessionForPacket(
  packetId: string,
  sessions: readonly ExecutionSession[],
): ExecutionSession | undefined {
  return sessions.find((s) => s.packetId === packetId && !isTerminalSessionStatus(s.status));
}

export function findAnySessionForPacket(
  packetId: string,
  sessions: readonly ExecutionSession[],
): ExecutionSession[] {
  return sessions.filter((s) => s.packetId === packetId);
}
