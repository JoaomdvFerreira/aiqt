import type { ExecutionSession } from "../schema/execution-session.schema.js";
import { isTerminalSessionStatus } from "../schema/execution-session.schema.js";
import type { ExecutionAdapterRequest } from "../schema/execution-adapter-request.schema.js";
import { findExecutionSessionById, findNonTerminalSessionForPacket } from "../services/execution-session-service.js";
import { findActiveAdapterRequestForSession, isAdapterRequestExpired } from "../services/execution-adapter-request-service.js";
import { generateGenericSessionClientKey, isLegacyProviderSpecificSession } from "./generic-session-identity.js";

export type GenericRequestResolution =
  | { kind: "retry"; existingRequest: ExecutionAdapterRequest; session: ExecutionSession }
  | { kind: "start"; sessionClientKey: string }
  | { kind: "resume"; session: ExecutionSession }
  | { kind: "blocked"; error: string; issueId: string }
  | { kind: "invalid"; error: string; issueId: string };

export interface ResolveGenericRequestParams {
  resumeSessionId?: string;
  workUnitId: string;
  currentPacketId: string;
  packetHasCheckpoint: boolean;
  sessions: readonly ExecutionSession[];
  adapterRequests: readonly ExecutionAdapterRequest[];
  effectiveNow: string;
  /** true for `aiqt execution external request`; false for the Claude adapter, which may still target a legacy provider-specific session. */
  requireGenericProvider: boolean;
}

/**
 * M27R §5.3: the shared session/request resolution algorithm used by both
 * the generic `execution external request` command and the refactored
 * Claude adapter request command (WU27R-05) -- never two independent
 * implementations of "first request vs. retry vs. resume vs. independent
 * attempt." Callers still own building and persisting the final
 * ExecutionAdapterRequest record themselves, since adapter-specific
 * fields (Claude's externalSessionId/providerVersionConstraint) differ.
 */
export function resolveGenericRequest(params: ResolveGenericRequestParams): GenericRequestResolution {
  const { resumeSessionId, workUnitId, currentPacketId, packetHasCheckpoint, sessions, adapterRequests, effectiveNow, requireGenericProvider } = params;

  if (resumeSessionId) {
    const session = findExecutionSessionById(resumeSessionId, sessions);
    if (!session) {
      return { kind: "invalid", error: `No execution session "${resumeSessionId}" exists.`, issueId: "EXTERNAL-REQUEST-UNKNOWN-SESSION" };
    }
    if (session.workUnitId !== workUnitId || session.packetId !== currentPacketId) {
      return { kind: "invalid", error: `Execution session "${session.id}" does not belong to the current work unit/packet.`, issueId: "EXTERNAL-REQUEST-SESSION-MISMATCH" };
    }
    if (requireGenericProvider && isLegacyProviderSpecificSession(session)) {
      return {
        kind: "invalid",
        error: `Execution session "${session.id}" is a legacy provider-specific session and cannot be resumed through the generic path.`,
        issueId: "EXTERNAL-REQUEST-LEGACY-SESSION-NOT-SUPPORTED",
      };
    }
    if (isTerminalSessionStatus(session.status)) {
      return { kind: "blocked", error: `Execution session "${session.id}" is terminal (${session.status}) and cannot be resumed.`, issueId: "EXTERNAL-REQUEST-SESSION-TERMINAL" };
    }
    if (session.decisions.some((d) => d.status === "open")) {
      return { kind: "blocked", error: `Execution session "${session.id}" has an open decision; resolve it before requesting a resume.`, issueId: "EXTERNAL-REQUEST-OPEN-DECISION" };
    }
    if (session.iterations.some((i) => i.status === "running")) {
      return { kind: "blocked", error: `Execution session "${session.id}" already has a running iteration.`, issueId: "EXTERNAL-REQUEST-ITERATION-RUNNING" };
    }
    if (session.budgetState === "reached" || session.budgetState === "exceeded") {
      return { kind: "blocked", error: `Execution session "${session.id}" budget state (${session.budgetState}) blocks a new iteration.`, issueId: "EXTERNAL-REQUEST-BUDGET-STOP" };
    }
    const activeRequest = findActiveAdapterRequestForSession(session.id, adapterRequests, effectiveNow);
    if (activeRequest) {
      return { kind: "blocked", error: `An active adapter request (${activeRequest.id}) already exists for session "${session.id}".`, issueId: "EXTERNAL-REQUEST-ACTIVE-EXISTS" };
    }
    return { kind: "resume", session };
  }

  // §5.3 command-retry behavior: an already-active (requested, unexpired)
  // request for this exact packet is a retry of the same canonical
  // operation -- reuse it rather than creating a second M26 session.
  const activeRequestForPacket = adapterRequests.find(
    (r) => r.packetId === currentPacketId && r.status === "requested" && !isAdapterRequestExpired(r, effectiveNow),
  );
  if (activeRequestForPacket) {
    const session = findExecutionSessionById(activeRequestForPacket.executionSessionId, sessions);
    if (session) {
      return { kind: "retry", existingRequest: activeRequestForPacket, session };
    }
  }

  const nonTerminal = findNonTerminalSessionForPacket(currentPacketId, sessions);
  if (nonTerminal) {
    return {
      kind: "blocked",
      error: `A non-terminal execution session (${nonTerminal.id}) already exists for this packet; resume it instead of starting a new one.`,
      issueId: "EXTERNAL-REQUEST-NON-TERMINAL-SESSION-EXISTS",
    };
  }
  if (packetHasCheckpoint) {
    return { kind: "blocked", error: "A checkpoint already exists for this packet.", issueId: "EXTERNAL-REQUEST-CHECKPOINT-EXISTS" };
  }

  // §3.2: a genuinely new attempt (first-ever, or independent after prior
  // terminal history) always gets a fresh, AIQT-generated key.
  return { kind: "start", sessionClientKey: generateGenericSessionClientKey() };
}
