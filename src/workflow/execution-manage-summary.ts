import type { StateModel } from "../schema/state.schema.js";
import { getExecutionSessions } from "../services/execution-session-service.js";
import { isTerminalSessionStatus } from "../schema/execution-session.schema.js";

export interface ExecutionManageSummary {
  totalSessions: number;
  activeSessions: number;
  staleSessions: number;
  openDecisions: number;
  budgetStoppedSessions: number;
  terminalAwaitingCheckpoint: number;
  recommendedAction: string | null;
}

/**
 * M26 §5.4: bounded execution-session facts for `aiqt manage`. Does not
 * introduce a second classifier -- blocking execution review findings
 * (broken references, multiple non-terminal sessions, etc.) already flow
 * through the existing `classifyFindings` centralized owner via
 * `review.findings`; this is purely an additive data aggregation of
 * counts already present on canonical session records.
 */
export function buildExecutionManageSummary(state: StateModel): ExecutionManageSummary {
  const sessions = getExecutionSessions(state);
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      activeSessions: 0,
      staleSessions: 0,
      openDecisions: 0,
      budgetStoppedSessions: 0,
      terminalAwaitingCheckpoint: 0,
      recommendedAction: null,
    };
  }

  const activeSessions = sessions.filter((s) => !isTerminalSessionStatus(s.status)).length;
  const staleSessions = sessions.filter((s) => s.status === "stale").length;
  const openDecisions = sessions.reduce((sum, s) => sum + s.decisions.filter((d) => d.status === "open").length, 0);
  const budgetStoppedSessions = sessions.filter((s) => s.budgetState === "reached" || s.budgetState === "exceeded").length;
  const terminalAwaitingCheckpoint = sessions.filter(
    (s) => isTerminalSessionStatus(s.status) && !state.checkpoints.some((cp) => cp.packetId === s.packetId),
  ).length;

  let recommendedAction: string | null = null;
  if (openDecisions > 0) {
    recommendedAction = `Resolve ${openDecisions} open execution decision(s).`;
  } else if (terminalAwaitingCheckpoint > 0) {
    recommendedAction = `Run aiqt checkpoint for ${terminalAwaitingCheckpoint} terminal session(s) awaiting checkpoint.`;
  } else if (budgetStoppedSessions > 0) {
    recommendedAction = `Review budget usage for ${budgetStoppedSessions} session(s).`;
  } else if (staleSessions > 0) {
    recommendedAction = `${staleSessions} session(s) are stale; review via aiqt execution status.`;
  }

  return { totalSessions: sessions.length, activeSessions, staleSessions, openDecisions, budgetStoppedSessions, terminalAwaitingCheckpoint, recommendedAction };
}
