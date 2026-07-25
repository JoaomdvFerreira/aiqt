import { randomUUID } from "node:crypto";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildExecutionSessionOpenedEvent, buildExecutionAdapterRequestCreatedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { writeTextFile } from "../../core/filesystem/safe-writer.js";
import { getExecutionSessions, findSessionsForWorkUnit } from "../../services/execution-session-service.js";
import { getExecutionAdapterRequests, maxRequestSequenceForSession } from "../../services/execution-adapter-request-service.js";
import { applyExecutionProtocolEnvelope, type SessionOpenContext } from "../../workflow/execution-envelope-engine.js";
import { resolveWorkspaceRef } from "../../workflow/execution-workspace-ref-resolver.js";
import { resolveGenericRequest } from "../../workflow/generic-request-resolution.js";
import { generateGenericSessionClientKey, GENERIC_PROVIDER_ID } from "../../workflow/generic-session-identity.js";
import { findManagedWorkspaceById } from "../../services/workspace-state-service.js";
import { deriveAdapterRequestIdentity, computeAdapterRequestDigest } from "../../workflow/execution-adapter-request-identity.js";
import { buildClaudeCodeCommandArguments } from "../../schema/claude-code-request-package.schema.js";
import type { ClaudeCodeExecutionRequest } from "../../schema/claude-code-request-package.schema.js";
import { CLAUDE_ADAPTER_ID } from "../../schema/adapter-registry.js";
import { MAX_ADAPTER_REQUESTS, MAX_ADAPTER_REQUESTS_PER_SESSION } from "../../schema/execution-adapter-request.schema.js";
import type { ExecutionAdapterRequest } from "../../schema/execution-adapter-request.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

/** M27 §7: bounded default request lifetime. Not a live provider check -- purely a local expiry ceiling. */
export const ADAPTER_REQUEST_EXPIRY_SECONDS = 86400;

/** M27 §0/§1.3: fixed, Gate-G-approved provider version band. Not compared programmatically in M27 -- unrecognized output shape is rejected regardless of this string's value. */
export const ADAPTER_PROVIDER_VERSION_CONSTRAINT = "claude-code>=1.0.0 <2.0.0";

export interface RunExecutionAdapterClaudeCodeRequestOptions {
  workUnitId?: string;
  resumeSessionId?: string;
  preview?: boolean;
  output?: string;
  asOf?: string;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return makeResult({
    status: exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed",
    action: "execution",
    summary,
    exitCode,
    blockingIssues: [{ id: issueId, severity: "high", area: "execution", message: summary, agentCanFix: false }],
  });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function userActionChecklist(claudeNativeMode: "start" | "resume"): string[] {
  return [
    "Install and authenticate the Claude Code CLI yourself; AIQT never installs, logs in, or manages credentials.",
    "Do not add any permission-bypass flag; the generated command template is fixed and reviewed.",
    claudeNativeMode === "start"
      ? "Run the generated command, piping the current agent packet's prompt text to stdin, and capture stream-json output to a file or pipe."
      : "Run the generated command with --resume and the existing external session UUID, capturing stream-json output the same way.",
    "Import the captured output with: aiqt execution adapter claude-code import --request <request-id> --from-file <path> (or --stdin).",
  ];
}

function buildRequestPackage(
  request: ExecutionAdapterRequest,
  workspacePath: string | null,
  claudeNativeMode: "start" | "resume",
): ClaudeCodeExecutionRequest {
  return {
    contractVersion: "claude-code-stream-json-request@1",
    requestId: request.id,
    adapterId: request.adapterId,
    executionSessionId: request.executionSessionId,
    workUnitId: request.workUnitId,
    packetId: request.packetId,
    workspacePath,
    externalSessionId: request.externalSessionId!,
    mode: claudeNativeMode,
    prompt: { boundedText: true, source: "current_agent_packet" },
    commandTemplate: { executable: "claude", arguments: buildClaudeCodeCommandArguments(claudeNativeMode, request.externalSessionId!) },
    outputInstructions: { format: "stream-json", capture: "file_or_pipe_to_import" },
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    userActionRequired: userActionChecklist(claudeNativeMode),
  };
}

/**
 * aiqt execution adapter claude-code request <work-unit-id> [--resume-session
 * <id>] [--preview] [--output <path>] [--json] (M27 §3.2/§3.3/§4.1, M27R
 * §7.1): the sole boundary for generating a Claude Code request package.
 * Never executes, spawns, or contacts anything. Since M27R, every new
 * Claude adapter session uses providerId `external/agent` and an
 * AIQT-generated `external/<uuid>` sessionClientKey -- it participates in
 * the same generic identity space as `execution external request` and
 * any future adapter, and shares that exact session/request resolution
 * algorithm (resolveGenericRequest) with it. Claude's OWN native
 * provider session UUID (`externalSessionId`) is separate adapter
 * metadata used only to build the `--session-id`/`--resume` command
 * flag -- it is generated fresh whenever Claude has no prior native
 * transcript for this AIQT session (including when Claude is joining an
 * existing generic session for the first time), and reused only when
 * Claude itself previously operated this exact session.
 */
export async function runExecutionAdapterClaudeCodeRequest(
  ctx: CommandContext,
  options: RunExecutionAdapterClaudeCodeRequestOptions,
): Promise<CommandResult> {
  try {
    if (!options.workUnitId) {
      return failure("aiqt execution adapter claude-code request requires <work-unit-id>.", ExitCode.HumanInputRequired, "ADAPTER-REQUEST-NO-WORK-UNIT");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "ADAPTER-REQUEST-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ADAPTER-REQUEST-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    if (state.currentWorkUnitId !== options.workUnitId) {
      return failure(
        `Work unit ${options.workUnitId} is not the current work unit (current: ${state.currentWorkUnitId ?? "none"}).`,
        ExitCode.WorkflowBlocked,
        "ADAPTER-REQUEST-NOT-CURRENT-WORK-UNIT",
      );
    }
    const currentWorkUnit = state.workGraph.workUnits.find((wu) => wu.id === options.workUnitId);
    if (!currentWorkUnit || currentWorkUnit.status !== "in_progress") {
      return failure(`Work unit ${options.workUnitId} is not in_progress.`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-WORK-UNIT-NOT-IN-PROGRESS");
    }
    const currentPacketId = state.lastAgentPacket?.workUnitId === options.workUnitId ? (state.lastAgentPacket?.id ?? null) : null;
    if (currentPacketId === null) {
      return failure("No current packet for this work unit.", ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-NO-CURRENT-PACKET");
    }

    const sessions = getExecutionSessions(state);
    const adapterRequests = getExecutionAdapterRequests(state);
    const packetHasCheckpoint = state.checkpoints.some((cp) => cp.packetId === currentPacketId);

    if (adapterRequests.length >= MAX_ADAPTER_REQUESTS) {
      return failure(`State/request cap reached (max_adapter_requests=${MAX_ADAPTER_REQUESTS}).`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-CAP-REACHED");
    }

    const resolution = resolveGenericRequest({
      resumeSessionId: options.resumeSessionId,
      workUnitId: options.workUnitId,
      currentPacketId,
      packetHasCheckpoint,
      sessions,
      adapterRequests,
      effectiveNow,
      // M27R §7.1/§7.2: the Claude adapter may target either a new
      // external/agent session or an eligible legacy provider-specific
      // (anthropic/claude-code) session -- unlike the generic path, it
      // is never restricted to external/agent only.
      requireGenericProvider: false,
    });

    if (resolution.kind === "blocked") return failure(resolution.error, ExitCode.WorkflowBlocked, resolution.issueId);
    if (resolution.kind === "invalid") return failure(resolution.error, ExitCode.InvalidInput, resolution.issueId);

    const workspaceRefResolution = resolveWorkspaceRef(state, options.workUnitId);
    if (!workspaceRefResolution.ok) {
      return failure(workspaceRefResolution.error, ExitCode.InvalidInput, "ADAPTER-REQUEST-WORKSPACE-REF-INVALID");
    }
    const workspacePath =
      workspaceRefResolution.ref.mode === "managed"
        ? (findManagedWorkspaceById(workspaceRefResolution.ref.workspaceId!, state.workspace?.managedWorkspaces ?? [])?.workspacePath ?? null)
        : null;

    if (resolution.kind === "retry") {
      // A retry regenerates the bundle for the exact same still-open
      // request; the Claude-native start/resume flag mirrors the M26-level
      // mode recorded when this request was first created (disclosed
      // simplification: only imperfect in the rare case where a foreign
      // adapter's session is retried by Claude before ever being imported).
      const claudeNativeMode: "start" | "resume" = resolution.existingRequest.mode;
      const requestPackage = buildRequestPackage(resolution.existingRequest, workspacePath, claudeNativeMode);
      if (options.output && !options.preview) {
        try {
          writeTextFile(options.output, JSON.stringify(requestPackage, null, 2) + "\n");
        } catch (err) {
          return failure(`Writing --output failed: ${(err as Error).message}.`, ExitCode.InvalidInput, "ADAPTER-REQUEST-OUTPUT-WRITE-FAILED");
        }
      }
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Reused active request ${resolution.existingRequest.id} for execution session ${resolution.session.id} (retry of the same canonical operation); no new state written.`,
        exitCode: ExitCode.Success,
        data: { request: resolution.existingRequest, requestPackage, outcome: "retry" },
      });
    }

    const mode: "start" | "resume" = resolution.kind === "resume" ? "resume" : "start";
    // M27R §7.1: Claude's own native transcript continuity is independent
    // of the M26-level start/resume distinction -- reuse Claude's prior
    // externalSessionId only when Claude itself already operated this
    // session; otherwise Claude has nothing native to resume.
    const priorClaudeExternalSessionId = resolution.kind === "resume" ? resolution.session.provider.externalSessionId : undefined;
    const claudeNativeMode: "start" | "resume" = priorClaudeExternalSessionId ? "resume" : "start";
    const externalSessionId = priorClaudeExternalSessionId ?? randomUUID();

    let candidateSessions = sessions;
    let targetSessionId: string;
    let sessionClientKey: string;
    let sessionOpenedRunlogNeeded = false;

    if (resolution.kind === "resume") {
      targetSessionId = resolution.session.id;
      sessionClientKey = resolution.session.sessionClientKey;
    } else {
      sessionClientKey = generateGenericSessionClientKey();
      const openContext: SessionOpenContext = {
        projectId: project.project.id,
        currentWorkUnitId: options.workUnitId,
        currentWorkUnitInProgress: true,
        currentPacketId,
        packetHasCheckpoint: false,
        workspaceRef: workspaceRefResolution.ref,
        sessionsForWorkUnitCount: findSessionsForWorkUnit(options.workUnitId, sessions).length,
        totalSessionsCount: sessions.length,
        nonTerminalSessionExistsForPacket: false,
      };
      const envelopeResult = applyExecutionProtocolEnvelope({
        sessions,
        envelope: {
          protocolVersion: "long-running-execution-protocol@1",
          providerId: GENERIC_PROVIDER_ID,
          sessionClientKey,
          events: [{ type: "session.opened", eventId: "ADAPTER-OPEN", at: effectiveNow, externalSessionId }],
        },
        effectiveNow,
        openContext,
        evidenceExists: () => false,
      });
      if (!envelopeResult.ok) {
        const exitCode = envelopeResult.category === "blocked" ? ExitCode.WorkflowBlocked : ExitCode.InvalidInput;
        return failure(envelopeResult.error, exitCode, "ADAPTER-REQUEST-SESSION-OPEN-REJECTED");
      }
      candidateSessions = envelopeResult.sessions;
      targetSessionId = envelopeResult.targetSessionId!;
      sessionOpenedRunlogNeeded = true;
    }

    const sessionRequestCount = adapterRequests.filter((r) => r.executionSessionId === targetSessionId).length;
    if (sessionRequestCount >= MAX_ADAPTER_REQUESTS_PER_SESSION) {
      return failure(`State/request cap reached (max_adapter_requests_per_session=${MAX_ADAPTER_REQUESTS_PER_SESSION}).`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-SESSION-CAP-REACHED");
    }

    const requestSequence = maxRequestSequenceForSession(targetSessionId, adapterRequests) + 1;
    const requestId = deriveAdapterRequestIdentity({ adapterId: CLAUDE_ADAPTER_ID, executionSessionId: targetSessionId, requestSequence });
    const requestDigest = computeAdapterRequestDigest({
      adapterId: CLAUDE_ADAPTER_ID,
      executionSessionId: targetSessionId,
      workUnitId: options.workUnitId,
      packetId: currentPacketId,
      requestSequence,
      externalSessionId,
      mode,
      providerVersionConstraint: ADAPTER_PROVIDER_VERSION_CONSTRAINT,
      sessionClientKey,
    });
    const expiresAt = new Date(Date.parse(effectiveNow) + ADAPTER_REQUEST_EXPIRY_SECONDS * 1000).toISOString();

    const newRequest: ExecutionAdapterRequest = {
      id: requestId,
      adapterId: CLAUDE_ADAPTER_ID,
      executionSessionId: targetSessionId,
      sessionClientKey,
      workUnitId: options.workUnitId,
      packetId: currentPacketId,
      workspaceRef: workspaceRefResolution.ref,
      requestSequence,
      externalSessionId,
      mode,
      status: "requested",
      requestDigest,
      providerVersionConstraint: ADAPTER_PROVIDER_VERSION_CONSTRAINT,
      createdAt: effectiveNow,
      expiresAt,
    };

    const requestPackage = buildRequestPackage(newRequest, workspacePath, claudeNativeMode);

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would generate a "${mode}" request for execution session ${targetSessionId} (request ${requestId}); no state written.`,
        exitCode: ExitCode.Success,
        data: { request: newRequest, requestPackage, outcome: mode },
      });
    }

    const finalState: StateModel = {
      ...state,
      executionSessions: candidateSessions,
      executionAdapterRequests: [...adapterRequests, newRequest],
    };
    writeStateModel(paths.stateFile, finalState);

    if (options.output) {
      try {
        writeTextFile(options.output, JSON.stringify(requestPackage, null, 2) + "\n");
      } catch (err) {
        return failure(`State was written successfully but writing --output failed: ${(err as Error).message}.`, ExitCode.InvalidInput, "ADAPTER-REQUEST-OUTPUT-WRITE-FAILED");
      }
    }

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      const relatedIds = [newRequest.id, targetSessionId, options.workUnitId];
      if (sessionOpenedRunlogNeeded) {
        appendRunlogEvent(
          paths.runlogFile,
          buildExecutionSessionOpenedEvent({
            id: nextEventId(),
            timestamp: effectiveNow,
            relatedIds,
            data: { sessionId: targetSessionId, providerId: GENERIC_PROVIDER_ID, workUnitId: options.workUnitId, packetId: currentPacketId, outcome: "created" },
          }),
        );
      }
      appendRunlogEvent(
        paths.runlogFile,
        buildExecutionAdapterRequestCreatedEvent({
          id: nextEventId(),
          timestamp: effectiveNow,
          relatedIds,
          data: { requestId: newRequest.id, executionSessionId: targetSessionId, workUnitId: options.workUnitId, mode, requestSequence },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "ADAPTER-REQUEST-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Generated Claude Code "${mode}" request ${requestId} for execution session ${targetSessionId}. Claude Code must be installed, authenticated, and run externally -- AIQT never executes it.`,
      completedActions: sessionOpenedRunlogNeeded
        ? ["Validated preconditions", "Opened execution session", "Persisted adapter request", "Wrote state.json", "Appended runlog event(s)"]
        : ["Validated preconditions", "Persisted adapter request", "Wrote state.json", "Appended runlog event(s)"],
      changedFiles: options.output ? [paths.stateFile, paths.runlogFile, options.output] : [paths.stateFile, paths.runlogFile],
      affectedItems: [newRequest.id, targetSessionId],
      exitCode: ExitCode.Success,
      data: { request: newRequest, requestPackage, outcome: mode },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "ADAPTER-REQUEST-UNEXPECTED-ERROR");
  }
}
