import { randomUUID } from "node:crypto";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, readRunlogEventIds, buildExecutionSessionOpenedEvent, buildExecutionAdapterRequestCreatedEvent } from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { writeTextFile } from "../../core/filesystem/safe-writer.js";
import {
  getExecutionSessions,
  findSessionsForWorkUnit,
  findNonTerminalSessionForPacket,
  findExecutionSessionById,
} from "../../services/execution-session-service.js";
import {
  getExecutionAdapterRequests,
  findActiveAdapterRequestForSession,
  maxRequestSequenceForSession,
} from "../../services/execution-adapter-request-service.js";
import { applyExecutionProtocolEnvelope, type SessionOpenContext } from "../../workflow/execution-envelope-engine.js";
import { resolveWorkspaceRef } from "../../workflow/execution-workspace-ref-resolver.js";
import { findManagedWorkspaceById } from "../../services/workspace-state-service.js";
import { deriveAdapterRequestIdentity, computeAdapterRequestDigest } from "../../workflow/execution-adapter-request-identity.js";
import { buildClaudeCodeCommandArguments } from "../../schema/claude-code-request-package.schema.js";
import type { ClaudeCodeExecutionRequest } from "../../schema/claude-code-request-package.schema.js";
import { ADAPTER_ID, MAX_ADAPTER_REQUESTS, MAX_ADAPTER_REQUESTS_PER_SESSION } from "../../schema/execution-adapter-request.schema.js";
import { isTerminalSessionStatus } from "../../schema/execution-session.schema.js";
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

function userActionChecklist(mode: "start" | "resume"): string[] {
  return [
    "Install and authenticate the Claude Code CLI yourself; AIQT never installs, logs in, or manages credentials.",
    "Do not add any permission-bypass flag; the generated command template is fixed and reviewed.",
    mode === "start"
      ? "Run the generated command, piping the current agent packet's prompt text to stdin, and capture stream-json output to a file or pipe."
      : "Run the generated command with --resume and the existing external session UUID, capturing stream-json output the same way.",
    "Import the captured output with: aiqt execution adapter claude-code import --request <request-id> --from-file <path> (or --stdin).",
  ];
}

function buildRequestPackage(
  request: ExecutionAdapterRequest,
  workspacePath: string | null,
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
    mode: request.mode,
    prompt: { boundedText: true, source: "current_agent_packet" },
    commandTemplate: { executable: "claude", arguments: buildClaudeCodeCommandArguments(request.mode, request.externalSessionId!) },
    outputInstructions: { format: "stream-json", capture: "file_or_pipe_to_import" },
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    userActionRequired: userActionChecklist(request.mode),
  };
}

/**
 * aiqt execution adapter claude-code request <work-unit-id> [--resume-session
 * <id>] [--preview] [--output <path>] [--json] (M27 §3.2/§3.3/§4.1): the
 * sole boundary for generating a Claude Code request package. Never
 * executes, spawns, or contacts anything -- only reads/validates M26/M25
 * state, allocates (or reuses) an external session UUID, and writes a
 * bounded ExecutionAdapterRequest metadata record plus the non-canonical
 * request package. For a new session this reuses the exact same
 * candidate-state/envelope engine as `aiqt execution import`'s
 * session.opened path; for a resume it validates but does not mutate the
 * M26 session (the actual resume transition happens at import time, per
 * §5.3).
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

    if (adapterRequests.length >= MAX_ADAPTER_REQUESTS) {
      return failure(`State/request cap reached (max_adapter_requests=${MAX_ADAPTER_REQUESTS}).`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-CAP-REACHED");
    }

    const session = options.resumeSessionId ? findExecutionSessionById(options.resumeSessionId, sessions) : undefined;

    if (options.resumeSessionId) {
      // -- Resume request: reuse an existing, non-terminal M26 session. --
      if (!session) {
        return failure(`No execution session "${options.resumeSessionId}" exists.`, ExitCode.InvalidInput, "ADAPTER-REQUEST-UNKNOWN-SESSION");
      }
      if (session.workUnitId !== options.workUnitId || session.packetId !== currentPacketId) {
        return failure(
          `Execution session "${session.id}" does not belong to the current work unit/packet.`,
          ExitCode.InvalidInput,
          "ADAPTER-REQUEST-SESSION-MISMATCH",
        );
      }
      if (isTerminalSessionStatus(session.status)) {
        return failure(`Execution session "${session.id}" is terminal (${session.status}) and cannot be resumed.`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-SESSION-TERMINAL");
      }
      if (session.decisions.some((d) => d.status === "open")) {
        return failure(`Execution session "${session.id}" has an open decision; resolve it before requesting a resume.`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-OPEN-DECISION");
      }
      if (session.iterations.some((i) => i.status === "running")) {
        return failure(`Execution session "${session.id}" already has a running iteration.`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-ITERATION-RUNNING");
      }
      if (session.budgetState === "reached" || session.budgetState === "exceeded") {
        return failure(`Execution session "${session.id}" budget state (${session.budgetState}) blocks a new iteration.`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-BUDGET-STOP");
      }
      const activeRequest = findActiveAdapterRequestForSession(session.id, adapterRequests, effectiveNow);
      if (activeRequest) {
        return failure(`An active adapter request (${activeRequest.id}) already exists for session "${session.id}".`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-ACTIVE-EXISTS");
      }
      if (!session.provider.externalSessionId) {
        return failure(`Execution session "${session.id}" has no external session UUID recorded.`, ExitCode.InvalidInput, "ADAPTER-REQUEST-MISSING-EXTERNAL-SESSION-ID");
      }
      const sessionRequestCount = adapterRequests.filter((r) => r.executionSessionId === session!.id).length;
      if (sessionRequestCount >= MAX_ADAPTER_REQUESTS_PER_SESSION) {
        return failure(`State/request cap reached (max_adapter_requests_per_session=${MAX_ADAPTER_REQUESTS_PER_SESSION}).`, ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-SESSION-CAP-REACHED");
      }
    } else {
      // -- New (start) request: at most one non-terminal session per packet, per M26. --
      const existingNonTerminal = findNonTerminalSessionForPacket(currentPacketId, sessions);
      if (existingNonTerminal) {
        return failure(
          `A non-terminal execution session (${existingNonTerminal.id}) already exists for this packet; resume it instead of starting a new one.`,
          ExitCode.WorkflowBlocked,
          "ADAPTER-REQUEST-NON-TERMINAL-SESSION-EXISTS",
        );
      }
      const packetHasCheckpoint = state.checkpoints.some((cp) => cp.packetId === currentPacketId);
      if (packetHasCheckpoint) {
        return failure("A checkpoint already exists for this packet.", ExitCode.WorkflowBlocked, "ADAPTER-REQUEST-CHECKPOINT-EXISTS");
      }
    }

    const workspaceRefResolution = resolveWorkspaceRef(state, options.workUnitId);
    if (!workspaceRefResolution.ok) {
      return failure(workspaceRefResolution.error, ExitCode.InvalidInput, "ADAPTER-REQUEST-WORKSPACE-REF-INVALID");
    }

    const mode: "start" | "resume" = session ? "resume" : "start";
    const externalSessionId = session?.provider.externalSessionId ?? randomUUID();
    const sessionClientKey = `${ADAPTER_ID}:${options.workUnitId}:${currentPacketId}`;

    let candidateSessions = sessions;
    let targetSessionId: string;
    let sessionOpenedRunlogNeeded = false;

    if (session) {
      targetSessionId = session.id;
    } else {
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
          providerId: "anthropic/claude-code",
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

    const requestSequence = maxRequestSequenceForSession(targetSessionId, adapterRequests) + 1;
    const requestId = deriveAdapterRequestIdentity({ adapterId: ADAPTER_ID, executionSessionId: targetSessionId, requestSequence });
    const requestDigest = computeAdapterRequestDigest({
      adapterId: ADAPTER_ID,
      executionSessionId: targetSessionId,
      workUnitId: options.workUnitId,
      packetId: currentPacketId,
      requestSequence,
      externalSessionId,
      mode,
      providerVersionConstraint: ADAPTER_PROVIDER_VERSION_CONSTRAINT,
    });
    const expiresAt = new Date(Date.parse(effectiveNow) + ADAPTER_REQUEST_EXPIRY_SECONDS * 1000).toISOString();

    const newRequest: ExecutionAdapterRequest = {
      id: requestId,
      adapterId: ADAPTER_ID,
      executionSessionId: targetSessionId,
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

    const workspacePath =
      workspaceRefResolution.ref.mode === "managed"
        ? (findManagedWorkspaceById(workspaceRefResolution.ref.workspaceId!, state.workspace?.managedWorkspaces ?? [])?.workspacePath ?? null)
        : null;
    const requestPackage = buildRequestPackage(newRequest, workspacePath);

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would generate a "${mode}" request for execution session ${targetSessionId} (request ${requestId}); no state written.`,
        exitCode: ExitCode.Success,
        data: { request: newRequest, requestPackage },
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
      const existingIds = readRunlogEventIds(paths.runlogFile);
      const allocated = [...existingIds];
      const nextEventId = () => {
        const id = nextId("EVT", allocated);
        allocated.push(id);
        return id;
      };
      const relatedIds = [newRequest.id, targetSessionId, options.workUnitId];
      if (sessionOpenedRunlogNeeded) {
        appendRunlogEvent(
          paths.runlogFile,
          buildExecutionSessionOpenedEvent({
            id: nextEventId(),
            timestamp: effectiveNow,
            relatedIds,
            data: { sessionId: targetSessionId, providerId: "anthropic/claude-code", workUnitId: options.workUnitId, packetId: currentPacketId, outcome: "created" },
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
      data: { request: newRequest, requestPackage },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "ADAPTER-REQUEST-UNEXPECTED-ERROR");
  }
}
