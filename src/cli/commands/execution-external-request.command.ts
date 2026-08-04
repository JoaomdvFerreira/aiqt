import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildExecutionSessionOpenedEvent, buildExecutionAdapterRequestCreatedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { writeTextFile } from "../../core/filesystem/safe-writer.js";
import {
  getExecutionSessions,
  findSessionsForWorkUnit,
} from "../../services/execution-session-service.js";
import { getExecutionAdapterRequests, maxRequestSequenceForSession } from "../../services/execution-adapter-request-service.js";
import { applyExecutionProtocolEnvelope, type SessionOpenContext } from "../../workflow/execution-envelope-engine.js";
import { resolveWorkspaceRef } from "../../workflow/execution-workspace-ref-resolver.js";
import { resolveGenericRequest } from "../../workflow/generic-request-resolution.js";
import { deriveAdapterRequestIdentity, computeAdapterRequestDigest } from "../../workflow/execution-adapter-request-identity.js";
import { GENERIC_PROVIDER_ID } from "../../workflow/generic-session-identity.js";
import { GENERIC_ADAPTER_ID, GENERIC_MAX_REQUESTS_PER_SESSION, GENERIC_MAX_REQUESTS_PER_WORK_UNIT } from "../../schema/adapter-registry.js";
import { MAX_ADAPTER_REQUESTS } from "../../schema/execution-adapter-request.schema.js";
import type { ExecutionAdapterRequest } from "../../schema/execution-adapter-request.schema.js";
import type { ExternalExecutionRequest, RequestPacketSummary } from "../../schema/external-execution-request.schema.js";
import { EXTERNAL_REQUEST_INSTRUCTIONS_MD, EXAMPLE_EXTERNAL_RESULT, EXTERNAL_RESULT_JSON_SCHEMA } from "./execution-external-example.js";
import type { StateModel } from "../../schema/state.schema.js";

/** M27R §5: bounded default request lifetime, mirroring the Claude adapter's own convention. */
export const EXTERNAL_REQUEST_EXPIRY_SECONDS = 86400;

export interface RunExecutionExternalRequestOptions {
  workUnitId?: string;
  resumeSessionId?: string;
  preview?: boolean;
  output?: string;
  asOf?: string;
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

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function buildRequestPacketSummary(workUnit: { id: string; objective: string; scope: string[]; outOfScope: string[]; acceptanceCriteria: string[]; validationCommands: string[] }, packetId: string): RequestPacketSummary {
  return {
    sourcePacketId: packetId,
    role: "implementer",
    scope: workUnit.scope,
    outOfScope: workUnit.outOfScope,
    constraints: [],
    acceptanceCriteria: workUnit.acceptanceCriteria,
    validationCommands: workUnit.validationCommands,
  };
}

function writeBundle(outputDir: string, request: ExternalExecutionRequest): void {
  mkdirSync(outputDir, { recursive: true });
  writeTextFile(join(outputDir, "request.json"), JSON.stringify(request, null, 2) + "\n");
  writeTextFile(join(outputDir, "instructions.md"), EXTERNAL_REQUEST_INSTRUCTIONS_MD);
  writeTextFile(join(outputDir, "result.example.json"), JSON.stringify(EXAMPLE_EXTERNAL_RESULT, null, 2) + "\n");
  writeTextFile(join(outputDir, "result.schema.json"), JSON.stringify(EXTERNAL_RESULT_JSON_SCHEMA, null, 2) + "\n");
}

/**
 * aiqt execution external request <work-unit-id> [--resume-session <id>]
 * [--preview] [--output <dir>] [--json] (M27R §5): the sole boundary for
 * generating the vendor-neutral generic request bundle. Never executes,
 * spawns, or contacts any agent -- only reads/validates M26/M25 state,
 * allocates (or reuses) an AIQT-owned generic sessionClientKey, and
 * writes a bounded ExecutionAdapterRequest metadata record plus the
 * non-canonical export bundle. Shares its session/request resolution
 * algorithm with the refactored Claude adapter request command via
 * resolveGenericRequest -- never a parallel implementation.
 */
export async function runExecutionExternalRequest(ctx: CommandContext, options: RunExecutionExternalRequestOptions): Promise<CommandResult> {
  try {
    if (!options.workUnitId) {
      return failure("aiqt execution external request requires <work-unit-id>.", ExitCode.HumanInputRequired, "EXTERNAL-REQUEST-NO-WORK-UNIT");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EXTERNAL-REQUEST-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXTERNAL-REQUEST-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    if (state.currentWorkUnitId !== options.workUnitId) {
      return failure(
        `Work unit ${options.workUnitId} is not the current work unit (current: ${state.currentWorkUnitId ?? "none"}).`,
        ExitCode.WorkflowBlocked,
        "EXTERNAL-REQUEST-NOT-CURRENT-WORK-UNIT",
      );
    }
    const currentWorkUnit = state.workGraph.workUnits.find((wu) => wu.id === options.workUnitId);
    if (!currentWorkUnit || currentWorkUnit.status !== "in_progress") {
      return failure(`Work unit ${options.workUnitId} is not in_progress.`, ExitCode.WorkflowBlocked, "EXTERNAL-REQUEST-WORK-UNIT-NOT-IN-PROGRESS");
    }
    const currentPacketId = state.lastAgentPacket?.workUnitId === options.workUnitId ? (state.lastAgentPacket?.id ?? null) : null;
    if (currentPacketId === null) {
      return failure("No current packet for this work unit.", ExitCode.WorkflowBlocked, "EXTERNAL-REQUEST-NO-CURRENT-PACKET");
    }

    const sessions = getExecutionSessions(state);
    const adapterRequests = getExecutionAdapterRequests(state);
    const packetHasCheckpoint = state.checkpoints.some((cp) => cp.packetId === currentPacketId);

    if (adapterRequests.length >= MAX_ADAPTER_REQUESTS) {
      return failure(`State/request cap reached (max_adapter_requests=${MAX_ADAPTER_REQUESTS}).`, ExitCode.WorkflowBlocked, "EXTERNAL-REQUEST-CAP-REACHED");
    }
    const requestsForWorkUnit = adapterRequests.filter((r) => r.workUnitId === options.workUnitId).length;
    if (requestsForWorkUnit >= GENERIC_MAX_REQUESTS_PER_WORK_UNIT) {
      return failure(`State/request cap reached (max_requests_per_work_unit=${GENERIC_MAX_REQUESTS_PER_WORK_UNIT}).`, ExitCode.WorkflowBlocked, "EXTERNAL-REQUEST-WORK-UNIT-CAP-REACHED");
    }

    const resolution = resolveGenericRequest({
      resumeSessionId: options.resumeSessionId,
      workUnitId: options.workUnitId,
      currentPacketId,
      packetHasCheckpoint,
      sessions,
      adapterRequests,
      effectiveNow,
      requireGenericProvider: true,
    });

    if (resolution.kind === "blocked") return failure(resolution.error, ExitCode.WorkflowBlocked, resolution.issueId);
    if (resolution.kind === "invalid") return failure(resolution.error, ExitCode.InvalidInput, resolution.issueId);

    const workspaceRefResolution = resolveWorkspaceRef(state, options.workUnitId);
    if (!workspaceRefResolution.ok) {
      return failure(workspaceRefResolution.error, ExitCode.InvalidInput, "EXTERNAL-REQUEST-WORKSPACE-REF-INVALID");
    }

    if (resolution.kind === "retry") {
      const packet = buildRequestPacketSummary(currentWorkUnit, currentPacketId);
      const requestPackage: ExternalExecutionRequest = {
        protocolVersion: "aiqt-external-execution-request@1",
        requestId: resolution.existingRequest.id,
        executionSessionId: resolution.session.id,
        sessionClientKey: resolution.session.sessionClientKey,
        workUnitId: options.workUnitId,
        packetId: currentPacketId,
        workspaceRef: workspaceRefResolution.ref,
        requestSequence: resolution.existingRequest.requestSequence,
        objective: currentWorkUnit.objective,
        packet,
        expectedResultProtocol: "aiqt-external-execution-result@1",
        createdAt: resolution.existingRequest.createdAt,
        expiresAt: resolution.existingRequest.expiresAt,
      };
      if (options.output && !options.preview) writeBundle(options.output, requestPackage);
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
    let candidateSessions = sessions;
    let targetSessionId: string;
    let sessionClientKey: string;
    let sessionOpenedRunlogNeeded = false;

    if (resolution.kind === "resume") {
      targetSessionId = resolution.session.id;
      sessionClientKey = resolution.session.sessionClientKey;
    } else {
      sessionClientKey = resolution.sessionClientKey;
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
          events: [{ type: "session.opened", eventId: "EXTERNAL-OPEN", at: effectiveNow }],
        },
        effectiveNow,
        openContext,
        evidenceExists: () => false,
      });
      if (!envelopeResult.ok) {
        const exitCode = envelopeResult.category === "blocked" ? ExitCode.WorkflowBlocked : ExitCode.InvalidInput;
        return failure(envelopeResult.error, exitCode, "EXTERNAL-REQUEST-SESSION-OPEN-REJECTED");
      }
      candidateSessions = envelopeResult.sessions;
      targetSessionId = envelopeResult.targetSessionId!;
      sessionOpenedRunlogNeeded = true;
    }

    const sessionRequestCount = adapterRequests.filter((r) => r.executionSessionId === targetSessionId).length;
    if (sessionRequestCount >= GENERIC_MAX_REQUESTS_PER_SESSION) {
      return failure(`State/request cap reached (max_requests_per_session=${GENERIC_MAX_REQUESTS_PER_SESSION}).`, ExitCode.WorkflowBlocked, "EXTERNAL-REQUEST-SESSION-CAP-REACHED");
    }

    const requestSequence = maxRequestSequenceForSession(targetSessionId, adapterRequests) + 1;
    const requestId = deriveAdapterRequestIdentity({ adapterId: GENERIC_ADAPTER_ID, executionSessionId: targetSessionId, requestSequence });
    const requestDigest = computeAdapterRequestDigest({
      adapterId: GENERIC_ADAPTER_ID,
      executionSessionId: targetSessionId,
      workUnitId: options.workUnitId,
      packetId: currentPacketId,
      requestSequence,
      mode,
      sessionClientKey,
    });
    const expiresAt = new Date(Date.parse(effectiveNow) + EXTERNAL_REQUEST_EXPIRY_SECONDS * 1000).toISOString();

    const newRequest: ExecutionAdapterRequest = {
      id: requestId,
      adapterId: GENERIC_ADAPTER_ID,
      executionSessionId: targetSessionId,
      sessionClientKey,
      workUnitId: options.workUnitId,
      packetId: currentPacketId,
      workspaceRef: workspaceRefResolution.ref,
      requestSequence,
      mode,
      status: "requested",
      requestDigest,
      createdAt: effectiveNow,
      expiresAt,
    };

    const packet = buildRequestPacketSummary(currentWorkUnit, currentPacketId);
    const requestPackage: ExternalExecutionRequest = {
      protocolVersion: "aiqt-external-execution-request@1",
      requestId: newRequest.id,
      executionSessionId: targetSessionId,
      sessionClientKey,
      workUnitId: options.workUnitId,
      packetId: currentPacketId,
      workspaceRef: workspaceRefResolution.ref,
      requestSequence,
      objective: currentWorkUnit.objective,
      packet,
      expectedResultProtocol: "aiqt-external-execution-result@1",
      createdAt: newRequest.createdAt,
      expiresAt: newRequest.expiresAt,
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would generate a "${mode}" generic request for execution session ${targetSessionId} (request ${requestId}); no state written.`,
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
        writeBundle(options.output, requestPackage);
      } catch (err) {
        return failure(`State was written successfully but writing the bundle to --output failed: ${(err as Error).message}.`, ExitCode.InvalidInput, "EXTERNAL-REQUEST-OUTPUT-WRITE-FAILED");
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
        "EXTERNAL-REQUEST-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Generated generic "${mode}" request ${requestId} for execution session ${targetSessionId}. AIQT does not run any agent -- use any external coding agent with this bundle.`,
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
    return failure(message, ExitCode.InvalidInput, "EXTERNAL-REQUEST-UNEXPECTED-ERROR");
  }
}
