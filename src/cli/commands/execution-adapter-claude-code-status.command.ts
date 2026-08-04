import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getExecutionAdapterRequests, isAdapterRequestExpired } from "../../services/execution-adapter-request-service.js";
import { getExecutionSessions, findExecutionSessionById } from "../../services/execution-session-service.js";
import { ADAPTER_ID } from "../../schema/execution-adapter-request.schema.js";
import type { ExecutionAdapterRequest } from "../../schema/execution-adapter-request.schema.js";
import { isLegacyProviderSpecificSession } from "../../workflow/generic-session-identity.js";

export interface RunExecutionAdapterClaudeCodeStatusOptions {
  sessionId?: string;
}

/**
 * @deprecated M33-WU05: this per-file wrapper now only delegates to the
 * shared familyFailureResult() (M33-WU02) -- prefer calling
 * familyFailureResult() directly in any new code. Retained here only to
 * avoid rewriting every existing call site in this file; not removed
 * because doing so would touch call sites with no behavioral benefit.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "execution", area: "execution", summary, exitCode, issueId });
}

/**
 * M27 §6.1: a normalized health judgment derived ONLY from already-imported
 * evidence -- never a live probe of the Claude executable, network,
 * account, credentials, or provider service.
 */
type AdapterHealth = "unknown" | "healthy" | "degraded" | "unavailable" | "failed";

function judgeHealth(request: ExecutionAdapterRequest | undefined): AdapterHealth {
  if (!request?.invocationSummary) return "unknown";
  switch (request.invocationSummary.resultClass) {
    case "success":
      return request.invocationSummary.apiRetryCount > 0 ? "degraded" : "healthy";
    case "limited":
      return "degraded";
    case "unavailable":
      return "unavailable";
    case "failed":
      return "failed";
  }
}

function summarizeRequest(request: ExecutionAdapterRequest, effectiveNow: string, sessions: readonly { id: string; provider: { providerId: string } }[]) {
  const session = sessions.find((s) => s.id === request.executionSessionId);
  return {
    id: request.id,
    executionSessionId: request.executionSessionId,
    workUnitId: request.workUnitId,
    mode: request.mode,
    status: request.status,
    requestSequence: request.requestSequence,
    expired: request.status === "requested" && isAdapterRequestExpired(request, effectiveNow),
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    importedAt: request.importedAt ?? null,
    invocationSummary: request.invocationSummary ?? null,
    sessionKind: session ? (isLegacyProviderSpecificSession(session) ? "legacy_provider_specific_session" : "generic") : null,
  };
}

/**
 * aiqt execution adapter claude-code status [--session <id>] [--json]
 * (M27 §6.1): read-only. Never probes the Claude executable, network,
 * account, credentials, or provider service -- reports only what has
 * already been imported into canonical state.
 */
export function runExecutionAdapterClaudeCodeStatus(ctx: CommandContext, options: RunExecutionAdapterClaudeCodeStatusOptions = {}): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ADAPTER-STATUS-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const effectiveNow = new Date().toISOString();
  const allRequests = getExecutionAdapterRequests(state);
  const sessions = getExecutionSessions(state);

  const scoped = options.sessionId ? allRequests.filter((r) => r.executionSessionId === options.sessionId) : allRequests;
  if (options.sessionId && !findExecutionSessionById(options.sessionId, sessions)) {
    return failure(`Execution session ${options.sessionId} does not exist.`, ExitCode.InvalidInput, "ADAPTER-STATUS-UNKNOWN-SESSION");
  }

  const byStatus = { requested: 0, imported: 0, expired: 0, invalid: 0 };
  let staleOrExpiredCount = 0;
  for (const r of scoped) {
    byStatus[r.status] += 1;
    if (r.status === "requested" && isAdapterRequestExpired(r, effectiveNow)) staleOrExpiredCount += 1;
  }

  const activeRequest = scoped.find((r) => r.status === "requested" && !isAdapterRequestExpired(r, effectiveNow));
  const mostRecentImported = [...scoped].filter((r) => r.status === "imported").sort((a, b) => (a.importedAt! < b.importedAt! ? 1 : -1))[0];
  const health = judgeHealth(mostRecentImported);

  const userActionRequired: string[] = [];
  if (activeRequest) {
    userActionRequired.push(`Run the generated command for request ${activeRequest.id} externally, then import its captured output.`);
  }
  if (staleOrExpiredCount > 0) {
    userActionRequired.push(`${staleOrExpiredCount} request(s) have expired; generate a new request to continue.`);
  }
  if (health === "unavailable" || health === "failed") {
    userActionRequired.push("The most recent imported invocation reported a provider failure; investigate externally before requesting again.");
  }

  const nextRecommendedCommand = activeRequest
    ? "aiqt execution adapter claude-code import"
    : health === "unavailable" || health === "failed"
      ? null
      : "aiqt execution adapter claude-code request";

  return makeResult({
    status: "passed",
    action: "execution",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${scoped.length} Claude Code adapter request(s) (${byStatus.requested} requested, ${byStatus.imported} imported, ${staleOrExpiredCount} expired). Health: ${health}.`,
    nextRecommendedCommand,
    exitCode: ExitCode.Success,
    data: {
      adapterId: ADAPTER_ID,
      supportedMessageFamilies: ["system/init", "system/api_retry", "assistant", "user", "stream_event", "result"],
      requestCountsByStatus: byStatus,
      activeRequest: activeRequest ? summarizeRequest(activeRequest, effectiveNow, sessions) : null,
      health,
      providerVersionObserved: mostRecentImported?.invocationSummary?.providerVersion ?? null,
      staleOrExpiredCount,
      userActionRequired,
      requests: scoped.map((r) => summarizeRequest(r, effectiveNow, sessions)),
    },
  });
}
