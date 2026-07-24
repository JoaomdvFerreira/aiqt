import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFindingCandidate } from "./review-rules.js";
import { getExecutionAdapterRequests, isAdapterRequestExpired } from "../services/execution-adapter-request-service.js";
import { getExecutionSessions, findExecutionSessionById } from "../services/execution-session-service.js";
import { isTerminalSessionStatus } from "../schema/execution-session.schema.js";

const HIGH_API_RETRY_THRESHOLD = 3;

/**
 * M27 §6.2: Claude Code adapter review findings. Detects broken
 * session/work-unit/packet references, multiple active requests for one
 * session, external session ID drift, stale/expired requests, provider
 * unavailable/failed results, repeated API retries, and a terminal M26
 * session with an active adapter request. Routes through the same
 * canonical finding/issue mechanism as every other review rule (M22 §6);
 * no provider-specific finding lifecycle exists. Read-only; never mutates
 * state.
 */
export function collectExecutionAdapterFindings(state: StateModel): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];
  const requests = getExecutionAdapterRequests(state);
  if (requests.length === 0) return findings;

  const sessions = getExecutionSessions(state);
  const workUnitIds = new Set(state.workGraph.workUnits.map((wu) => wu.id));
  const effectiveNow = new Date().toISOString();
  const activeCountBySession = new Map<string, number>();

  for (const request of requests) {
    if (request.status === "requested" && !isAdapterRequestExpired(request, effectiveNow)) {
      activeCountBySession.set(request.executionSessionId, (activeCountBySession.get(request.executionSessionId) ?? 0) + 1);
    }
  }

  for (const request of requests) {
    const session = findExecutionSessionById(request.executionSessionId, sessions);

    if (!session) {
      findings.push({
        ruleKey: `execution-adapter.broken-session.${request.id}`,
        findingKey: `execution-adapter:${request.id}:broken-session-reference`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Claude Code adapter request references an unknown execution session",
        message: `Adapter request "${request.id}" references executionSessionId "${request.executionSessionId}", which does not exist.`,
        relatedIds: [request.id, request.executionSessionId],
        suggestedAction: "Investigate how this request was created; the referenced session is missing.",
        nextRecommendedCommand: "aiqt execution adapter claude-code status",
      });
      continue;
    }

    if (!workUnitIds.has(request.workUnitId) || session.workUnitId !== request.workUnitId) {
      findings.push({
        ruleKey: `execution-adapter.broken-work-unit.${request.id}`,
        findingKey: `execution-adapter:${request.id}:broken-work-unit-reference`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Claude Code adapter request references an inconsistent work unit",
        message: `Adapter request "${request.id}" references workUnitId "${request.workUnitId}", which is missing or inconsistent with its session.`,
        relatedIds: [request.id, request.workUnitId],
        suggestedAction: "Investigate this request's work-unit lineage.",
        nextRecommendedCommand: "aiqt execution adapter claude-code status",
      });
    }

    if (session.packetId !== request.packetId) {
      findings.push({
        ruleKey: `execution-adapter.packet-mismatch.${request.id}`,
        findingKey: `execution-adapter:${request.id}:packet-mismatch`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Claude Code adapter request's packet does not match its session's packet",
        message: `Adapter request "${request.id}" references packetId "${request.packetId}", which differs from session "${session.id}"'s packetId "${session.packetId}".`,
        relatedIds: [request.id, session.id],
        suggestedAction: "Investigate this request/session packet inconsistency.",
        nextRecommendedCommand: "aiqt execution adapter claude-code status",
      });
    }

    if (session.provider.externalSessionId !== undefined && session.provider.externalSessionId !== request.externalSessionId) {
      findings.push({
        ruleKey: `execution-adapter.session-id-drift.${request.id}`,
        findingKey: `execution-adapter:${request.id}:external-session-id-drift`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Claude Code adapter request's external session UUID drifted from its session",
        message: `Adapter request "${request.id}" externalSessionId does not match execution session "${session.id}"'s recorded provider.externalSessionId.`,
        relatedIds: [request.id, session.id],
        suggestedAction: "Investigate this identity drift; do not import against this request.",
        nextRecommendedCommand: "aiqt execution adapter claude-code status",
      });
    }

    if (request.status === "requested" && isAdapterRequestExpired(request, effectiveNow)) {
      findings.push({
        ruleKey: `execution-adapter.expired.${request.id}`,
        findingKey: `execution-adapter:${request.id}:expired`,
        category: "execution",
        severity: "medium",
        blocking: false,
        title: "Claude Code adapter request has expired",
        message: `Adapter request "${request.id}" expired at ${request.expiresAt} without being imported.`,
        relatedIds: [request.id],
        suggestedAction: "Generate a new request to continue this session.",
        nextRecommendedCommand: "aiqt execution adapter claude-code request",
      });
    }

    if (request.invocationSummary?.resultClass === "unavailable" || request.invocationSummary?.resultClass === "failed") {
      findings.push({
        ruleKey: `execution-adapter.provider-result.${request.id}`,
        findingKey: `execution-adapter:${request.id}:provider-${request.invocationSummary.resultClass}`,
        category: "execution",
        severity: "medium",
        blocking: false,
        title: `Claude Code invocation reported "${request.invocationSummary.resultClass}"`,
        message: `Adapter request "${request.id}" imported a provider result classified as "${request.invocationSummary.resultClass}".`,
        relatedIds: [request.id, session.id],
        suggestedAction: "Investigate externally (installation, authentication, or provider availability) before requesting again.",
        nextRecommendedCommand: "aiqt execution adapter claude-code status",
      });
    }

    if ((request.invocationSummary?.apiRetryCount ?? 0) >= HIGH_API_RETRY_THRESHOLD) {
      findings.push({
        ruleKey: `execution-adapter.high-retry.${request.id}`,
        findingKey: `execution-adapter:${request.id}:high-api-retry-count`,
        category: "execution",
        severity: "low",
        blocking: false,
        title: "Claude Code invocation reported repeated API retries",
        message: `Adapter request "${request.id}" reported ${request.invocationSummary!.apiRetryCount} API retries.`,
        relatedIds: [request.id],
        suggestedAction: "No action required; informational only.",
        nextRecommendedCommand: null,
      });
    }

    if (isTerminalSessionStatus(session.status) && request.status === "requested" && !isAdapterRequestExpired(request, effectiveNow)) {
      findings.push({
        ruleKey: `execution-adapter.terminal-active-request.${request.id}`,
        findingKey: `execution-adapter:${request.id}:terminal-session-active-request`,
        category: "execution",
        severity: "high",
        blocking: true,
        title: "Terminal execution session has an active Claude Code adapter request",
        message: `Execution session "${session.id}" is terminal (${session.status}) but adapter request "${request.id}" is still active.`,
        relatedIds: [request.id, session.id],
        suggestedAction: "Investigate this inconsistent request record.",
        nextRecommendedCommand: "aiqt execution adapter claude-code status",
      });
    }
  }

  for (const [sessionId, count] of activeCountBySession) {
    if (count > 1) {
      findings.push({
        ruleKey: `execution-adapter.multiple-active.${sessionId}`,
        findingKey: `execution-adapter:${sessionId}:multiple-active-requests`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Multiple active Claude Code adapter requests for one execution session",
        message: `Execution session "${sessionId}" has more than one active (requested, unexpired) adapter request, violating the at-most-one-active invariant.`,
        relatedIds: [sessionId],
        suggestedAction: "Investigate how two active requests were created for the same session.",
        nextRecommendedCommand: "aiqt execution adapter claude-code status",
      });
    }
  }

  return findings;
}
