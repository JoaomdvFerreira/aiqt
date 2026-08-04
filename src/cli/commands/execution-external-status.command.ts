import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getExecutionAdapterRequests, isAdapterRequestExpired } from "../../services/execution-adapter-request-service.js";
import { getExecutionSessions, findExecutionSessionById } from "../../services/execution-session-service.js";
import { isLegacyProviderSpecificSession } from "../../workflow/generic-session-identity.js";
import type { ExecutionAdapterRequest } from "../../schema/execution-adapter-request.schema.js";

export interface RunExecutionExternalStatusOptions {
  sessionId?: string;
  requestId?: string;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "execution", area: "execution", summary, exitCode, issueId });
}

function summarizeRequest(request: ExecutionAdapterRequest, effectiveNow: string) {
  return {
    id: request.id,
    adapterId: request.adapterId,
    executionSessionId: request.executionSessionId,
    workUnitId: request.workUnitId,
    mode: request.mode,
    status: request.status,
    requestSequence: request.requestSequence,
    expired: request.status === "requested" && isAdapterRequestExpired(request, effectiveNow),
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    importedAt: request.importedAt ?? null,
    importedAgent: request.importedAgent ?? null,
    importedIterationId: request.importedIterationId ?? null,
  };
}

/**
 * aiqt execution external status [--session <id>] [--request <id>]
 * [--json] (M27R §6.1/§8.1): read-only. Reports request/session/
 * iteration state, adapter used, imported agent identity, continuation
 * recommendation, self-reported validation summary, evidence/commit
 * counts, request expiry, and a recommended next action. Never probes
 * any external agent -- reports only what has already been imported
 * into canonical state.
 */
export function runExecutionExternalStatus(ctx: CommandContext, options: RunExecutionExternalStatusOptions = {}): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXTERNAL-STATUS-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const effectiveNow = new Date().toISOString();
  const allRequests = getExecutionAdapterRequests(state);
  const sessions = getExecutionSessions(state);

  if (options.requestId) {
    const request = allRequests.find((r) => r.id === options.requestId);
    if (!request) {
      return failure(`No adapter request "${options.requestId}" exists.`, ExitCode.InvalidInput, "EXTERNAL-STATUS-UNKNOWN-REQUEST");
    }
    const session = findExecutionSessionById(request.executionSessionId, sessions);
    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Adapter request "${request.id}" (${request.adapterId}): ${request.status}.`,
      exitCode: ExitCode.Success,
      data: {
        request: summarizeRequest(request, effectiveNow),
        session: session
          ? { id: session.id, status: session.status, providerId: session.provider.providerId, iterationCount: session.iterations.length, legacyProviderSpecificSession: isLegacyProviderSpecificSession(session) }
          : null,
      },
    });
  }

  const scoped = options.sessionId ? allRequests.filter((r) => r.executionSessionId === options.sessionId) : allRequests;
  if (options.sessionId && !findExecutionSessionById(options.sessionId, sessions)) {
    return failure(`Execution session ${options.sessionId} does not exist.`, ExitCode.InvalidInput, "EXTERNAL-STATUS-UNKNOWN-SESSION");
  }

  const byStatus = { requested: 0, imported: 0, expired: 0, invalid: 0 };
  let staleOrExpiredCount = 0;
  for (const r of scoped) {
    byStatus[r.status] += 1;
    if (r.status === "requested" && isAdapterRequestExpired(r, effectiveNow)) staleOrExpiredCount += 1;
  }
  const activeRequest = scoped.find((r) => r.status === "requested" && !isAdapterRequestExpired(r, effectiveNow));

  const genericSessions = sessions.filter((s) => !isLegacyProviderSpecificSession(s));
  const legacySessions = sessions.filter((s) => isLegacyProviderSpecificSession(s));

  const nextRecommendedCommand = activeRequest ? "aiqt execution external import" : "aiqt execution external request";

  return makeResult({
    status: "passed",
    action: "execution",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${scoped.length} generic-path adapter request(s) (${byStatus.requested} requested, ${byStatus.imported} imported, ${staleOrExpiredCount} expired). ${genericSessions.length} external/agent session(s), ${legacySessions.length} legacy provider-specific session(s).`,
    nextRecommendedCommand,
    exitCode: ExitCode.Success,
    data: {
      requestCountsByStatus: byStatus,
      activeRequest: activeRequest ? summarizeRequest(activeRequest, effectiveNow) : null,
      genericSessionCount: genericSessions.length,
      legacyProviderSpecificSessionCount: legacySessions.length,
      staleOrExpiredCount,
      requests: scoped.map((r) => summarizeRequest(r, effectiveNow)),
    },
  });
}
