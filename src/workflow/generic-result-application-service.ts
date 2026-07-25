import type { ExecutionSession } from "../schema/execution-session.schema.js";
import type { ExecutionAdapterRequest } from "../schema/execution-adapter-request.schema.js";
import type { NormalizedExternalExecutionResult } from "../schema/normalized-execution-result.schema.js";
import type { ExecutionProtocolEnvelope } from "../schema/execution-protocol-envelope.schema.js";
import { applyExecutionProtocolEnvelope, type ApplyEnvelopeResult, type AppliedEventRecord, type SessionOpenContext } from "./execution-envelope-engine.js";
import { GENERIC_MAX_SUMMARY_CHARS } from "../schema/adapter-registry.js";

export type ResultOutcome = {
  iterationStatus: "completed" | "blocked" | "failed";
  sessionStatus: "paused" | "blocked" | "failed";
};

/**
 * M27R §6.3 (result mapping table). Read only from the structured
 * `resultClass` field, never inferred from free text. The ONE mapping
 * used by every adapter's normalized result.
 */
const RESULT_CLASS_TO_OUTCOME: Record<NormalizedExternalExecutionResult["resultClass"], ResultOutcome> = {
  success: { iterationStatus: "completed", sessionStatus: "paused" },
  limited: { iterationStatus: "blocked", sessionStatus: "blocked" },
  unavailable: { iterationStatus: "failed", sessionStatus: "blocked" },
  failed: { iterationStatus: "failed", sessionStatus: "failed" },
};

export interface ApplyNormalizedResultParams {
  sessions: readonly ExecutionSession[];
  session: ExecutionSession;
  request: ExecutionAdapterRequest;
  normalized: NormalizedExternalExecutionResult;
  effectiveNow: string;
  evidenceExists: (evidenceId: string) => boolean;
}

export interface ApplyNormalizedResultSuccess {
  ok: true;
  changed: boolean;
  sessions: ExecutionSession[];
  targetSessionId: string;
  outcome: "updated" | "no_op";
  resultOutcome: ResultOutcome;
  iterationId: string | null;
  appliedEvents: AppliedEventRecord[];
}
export interface ApplyNormalizedResultFailure {
  ok: false;
  category: "invalid" | "blocked";
  error: string;
}
export type ApplyNormalizedResultResult = ApplyNormalizedResultSuccess | ApplyNormalizedResultFailure;

function boundedSummary(text: string): string {
  return text.length > GENERIC_MAX_SUMMARY_CHARS ? text.slice(0, GENERIC_MAX_SUMMARY_CHARS) : text;
}

/**
 * M27R §3.6/§6.3: the ONE shared service that maps a
 * NormalizedExternalExecutionResult onto exactly one M26 iteration.
 * Every adapter (generic-json@1, claude-code-stream-json@1, and any
 * future one) must terminate at NormalizedExternalExecutionResult and
 * call this exact function -- no adapter writes M26 state directly, and
 * no adapter defines its own completion semantics. Pure: applies through
 * the same M26 candidate-state envelope engine every other M26 mutation
 * path uses; the caller owns all I/O (state write, runlog append,
 * request finalization).
 */
export function applyNormalizedExecutionResult(params: ApplyNormalizedResultParams): ApplyNormalizedResultResult {
  const { sessions, session, request, normalized, effectiveNow, evidenceExists } = params;

  if (normalized.executionSessionId !== session.id) {
    return { ok: false, category: "invalid", error: `Normalized result executionSessionId "${normalized.executionSessionId}" does not match session "${session.id}".` };
  }
  if (normalized.requestId !== request.id) {
    return { ok: false, category: "invalid", error: `Normalized result requestId "${normalized.requestId}" does not match request "${request.id}".` };
  }
  for (const evidenceId of normalized.evidenceRefs) {
    if (!evidenceExists(evidenceId)) {
      return { ok: false, category: "invalid", error: `Evidence reference "${evidenceId}" does not resolve.` };
    }
  }

  const outcome = RESULT_CLASS_TO_OUTCOME[normalized.resultClass];

  const envelope: ExecutionProtocolEnvelope = {
    protocolVersion: "long-running-execution-protocol@1",
    providerId: session.provider.providerId,
    sessionClientKey: session.sessionClientKey,
    events: [
      { type: "session.status_changed", eventId: `${request.id}:running`, at: effectiveNow, toStatus: "running", reason: `${normalized.adapterId} import begins (agent: ${normalized.agent.providerId})` },
      { type: "iteration.started", eventId: `${request.id}:iter-start`, at: effectiveNow, providerIterationKey: request.id, objectiveSummary: boundedSummary(`${normalized.adapterId} invocation (request ${request.id}, agent ${normalized.agent.providerId})`) },
      {
        type: "iteration.finished",
        eventId: `${request.id}:iter-finish`,
        at: effectiveNow,
        providerIterationKey: request.id,
        status: outcome.iterationStatus,
        resultSummary: boundedSummary(normalized.summary),
        reportedTokens: normalized.reportedUsage?.reportedTokens,
        reportedDurationSeconds: normalized.reportedUsage?.reportedDurationSeconds,
        commitRefs: normalized.commitRefs.map((c) => ({ sha: c.sha, message: c.message })),
        evidenceRefs: normalized.evidenceRefs,
      },
      { type: "session.status_changed", eventId: `${request.id}:final-status`, at: effectiveNow, toStatus: outcome.sessionStatus, reason: `provider result: ${normalized.resultClass}` },
    ],
  };

  // The session already exists (this service never opens one), so the
  // openContext is structurally unused by the engine's existing-session
  // path -- populated only to satisfy the shared function's signature.
  const openContext: SessionOpenContext = {
    projectId: "",
    currentWorkUnitId: session.workUnitId,
    currentWorkUnitInProgress: true,
    currentPacketId: session.packetId,
    packetHasCheckpoint: false,
    workspaceRef: session.workspaceRef,
    sessionsForWorkUnitCount: 0,
    totalSessionsCount: sessions.length,
    nonTerminalSessionExistsForPacket: false,
  };

  const envelopeResult: ApplyEnvelopeResult = applyExecutionProtocolEnvelope({
    sessions,
    envelope,
    effectiveNow,
    openContext,
    evidenceExists,
  });

  if (!envelopeResult.ok) {
    return envelopeResult;
  }

  if (!envelopeResult.changed) {
    return { ok: true, changed: false, sessions: envelopeResult.sessions, targetSessionId: session.id, outcome: "no_op", resultOutcome: outcome, iterationId: null, appliedEvents: [] };
  }

  const iterationStarted = envelopeResult.appliedEvents.find((e) => e.event.type === "iteration.started");
  return {
    ok: true,
    changed: true,
    sessions: envelopeResult.sessions,
    targetSessionId: envelopeResult.targetSessionId!,
    outcome: "updated",
    resultOutcome: outcome,
    iterationId: iterationStarted?.focusId ?? null,
    appliedEvents: envelopeResult.appliedEvents,
  };
}
