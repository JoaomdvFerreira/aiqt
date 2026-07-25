import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildExecutionAdapterRequestImportedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory, buildRunlogEventForApplied } from "../../workflow/execution-runlog-event-builder.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { readBoundedTextFile } from "../../core/filesystem/bounded-file-input.js";
import { sha256Hex } from "../../core/util/hash.js";
import { parseClaudeCodeStreamJson } from "../../workflow/claude-code-stream-json-parser.js";
import { classifyClaudeCodeResult, buildClaudeProviderInvocationSummary } from "../../workflow/claude-code-result-normalizer.js";
import { STREAM_JSON_MAX_TOTAL_BYTES } from "../../schema/claude-code-stream-json.schema.js";
import { CLAUDE_ADAPTER_ID } from "../../schema/adapter-registry.js";
import { getExecutionSessions, findExecutionSessionById } from "../../services/execution-session-service.js";
import { getExecutionAdapterRequests, findAdapterRequestById, isAdapterRequestExpired } from "../../services/execution-adapter-request-service.js";
import { applyNormalizedExecutionResult } from "../../workflow/generic-result-application-service.js";
import { findEvidenceRecordById, getEvidenceRecords } from "../../services/evidence-service.js";
import type { NormalizedExternalExecutionResult } from "../../schema/normalized-execution-result.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunExecutionAdapterClaudeCodeImportOptions {
  requestId?: string;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RunExecutionAdapterClaudeCodeImportDeps {
  stdin?: StdinLike;
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

/**
 * aiqt execution adapter claude-code import --request <id> --from-file
 * <path> | --stdin [--preview] [--as-of <ts>] [--json] (M27 §4/§5, M27R
 * §7): the sole boundary for importing bounded Claude Code stream-json
 * output. Reads exactly one bounded transcript, hashes the exact raw
 * bytes, parses/validates it (the Claude-specific parser/classifier),
 * translates it into a NormalizedExternalExecutionResult, and applies it
 * through the SAME shared generic-result-application-service the
 * `execution external import` path uses -- never a parallel M26-mapping
 * implementation. Any failure before state write produces zero mutation.
 * Never executes a shell command, spawns a process, or performs network
 * I/O.
 */
export async function runExecutionAdapterClaudeCodeImport(
  ctx: CommandContext,
  options: RunExecutionAdapterClaudeCodeImportOptions,
  deps: RunExecutionAdapterClaudeCodeImportDeps = {},
): Promise<CommandResult> {
  try {
    if (!options.requestId) {
      return failure("aiqt execution adapter claude-code import requires --request <request-id>.", ExitCode.HumanInputRequired, "ADAPTER-IMPORT-NO-REQUEST-ID");
    }
    if (options.fromFile && options.stdin) {
      return failure("aiqt execution adapter claude-code import accepts exactly one of --from-file or --stdin, not both.", ExitCode.InvalidInput, "ADAPTER-IMPORT-CONFLICTING-INPUT");
    }
    if (!options.fromFile && !options.stdin) {
      return failure("aiqt execution adapter claude-code import requires --from-file <path> or --stdin.", ExitCode.HumanInputRequired, "ADAPTER-IMPORT-NO-INPUT");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "ADAPTER-IMPORT-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ADAPTER-IMPORT-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    const adapterRequests = getExecutionAdapterRequests(state);
    const request = findAdapterRequestById(options.requestId, adapterRequests);
    if (!request) {
      return failure(`No adapter request "${options.requestId}" exists.`, ExitCode.InvalidInput, "ADAPTER-IMPORT-UNKNOWN-REQUEST");
    }

    const sessions = getExecutionSessions(state);
    const session = findExecutionSessionById(request.executionSessionId, sessions);
    if (!session || session.workUnitId !== request.workUnitId || session.packetId !== request.packetId) {
      return failure(`Adapter request "${request.id}" references a broken session/work-unit/packet reference.`, ExitCode.InvalidInput, "ADAPTER-IMPORT-BROKEN-REFERENCE");
    }

    // Read the exact bounded raw bytes before any interpretation.
    let rawText: string;
    if (options.fromFile) {
      const read = readBoundedTextFile(options.fromFile, STREAM_JSON_MAX_TOTAL_BYTES);
      if (!read.ok) return failure(read.error, ExitCode.InvalidInput, "ADAPTER-IMPORT-FILE-INVALID");
      rawText = read.text;
    } else {
      if (isStdinInteractiveTty(deps.stdin)) {
        return failure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "ADAPTER-IMPORT-STDIN-TTY");
      }
      rawText = await readStdinText(deps.stdin);
      if (rawText.trim() === "") {
        return failure("Received empty input on stdin.", ExitCode.InvalidInput, "ADAPTER-IMPORT-STDIN-EMPTY");
      }
      if (Buffer.byteLength(rawText, "utf8") > STREAM_JSON_MAX_TOTAL_BYTES) {
        return failure(`Input exceeds max_total_bytes (${STREAM_JSON_MAX_TOTAL_BYTES}).`, ExitCode.InvalidInput, "ADAPTER-IMPORT-STDIN-TOO-LARGE");
      }
    }
    const sourceDigest = sha256Hex(rawText);

    // §4.4 replay/conflict/expiry rules, evaluated before any parsing.
    if (request.status === "imported") {
      if (request.importedSourceDigest === sourceDigest) {
        return makeResult({
          status: "passed",
          action: "execution",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: `Adapter request "${request.id}" was already imported with this exact source (idempotent no-op) -- no new state written.`,
          exitCode: ExitCode.Success,
          data: { requestId: request.id, outcome: "no_op" },
        });
      }
      return failure(`Adapter request "${request.id}" was already imported with a different source (digest conflict).`, ExitCode.InvalidInput, "ADAPTER-IMPORT-DIGEST-CONFLICT");
    }
    if (request.status === "invalid") {
      return failure(`Adapter request "${request.id}" is invalid and cannot be imported.`, ExitCode.WorkflowBlocked, "ADAPTER-IMPORT-REQUEST-INVALID");
    }
    if (isAdapterRequestExpired(request, effectiveNow)) {
      return failure(`Adapter request "${request.id}" has expired.`, ExitCode.WorkflowBlocked, "ADAPTER-IMPORT-REQUEST-EXPIRED");
    }

    const parseResult = parseClaudeCodeStreamJson(rawText);
    if (!parseResult.ok) {
      return failure(`Malformed, truncated, mixed-session, or unsupported stream-json input: ${parseResult.error}`, ExitCode.InvalidInput, "ADAPTER-IMPORT-PARSE-REJECTED");
    }
    const { summary } = parseResult;

    if (summary.sessionId !== request.externalSessionId) {
      return failure(
        `Imported output's session_id ("${summary.sessionId}") does not match the request's external session UUID ("${request.externalSessionId}").`,
        ExitCode.InvalidInput,
        "ADAPTER-IMPORT-SESSION-ID-MISMATCH",
      );
    }

    const resultClass = classifyClaudeCodeResult(summary);
    const invocationSummary = buildClaudeProviderInvocationSummary(request.id, summary);

    const normalized: NormalizedExternalExecutionResult = {
      protocolVersion: "aiqt-normalized-execution-result@1",
      adapterId: CLAUDE_ADAPTER_ID,
      requestId: request.id,
      executionSessionId: session.id,
      agent: { providerId: "anthropic/claude-code", version: summary.providerVersion },
      resultClass,
      summary: invocationSummary.resultSummary,
      continuation: { recommended: false },
      validationClaims: [],
      commitRefs: [],
      evidenceRefs: [],
      reportedUsage: { reportedTokens: invocationSummary.reportedTokens, reportedDurationSeconds: invocationSummary.reportedDurationSeconds },
      sourceDigest,
    };

    const evidenceRecords = getEvidenceRecords(state);
    const applyResult = applyNormalizedExecutionResult({
      sessions,
      session,
      request,
      normalized,
      effectiveNow,
      evidenceExists: (evidenceId) => findEvidenceRecordById(evidenceId, evidenceRecords) !== undefined,
    });
    if (!applyResult.ok) {
      const exitCode = applyResult.category === "blocked" ? ExitCode.WorkflowBlocked : ExitCode.InvalidInput;
      return failure(applyResult.error, exitCode, "ADAPTER-IMPORT-APPLY-REJECTED");
    }

    const planData = {
      requestId: request.id,
      resultClass,
      outcome: applyResult.outcome,
      targetSessionId: applyResult.targetSessionId,
      wouldChangeState: applyResult.changed,
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: importing this Claude Code output would classify as "${resultClass}" and update session ${applyResult.targetSessionId}; no state written.`,
        exitCode: ExitCode.Success,
        data: planData,
      });
    }

    if (!applyResult.changed) {
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: "Import resolves to a no-op -- no new state written.",
        exitCode: ExitCode.Success,
        data: planData,
      });
    }

    const updatedRequests = adapterRequests.map((r) =>
      r.id === request.id
        ? {
            ...r,
            status: "imported" as const,
            importedSourceDigest: sourceDigest,
            importedAt: effectiveNow,
            importedIterationId: applyResult.iterationId ?? undefined,
            importedAgent: normalized.agent,
            invocationSummary,
          }
        : r,
    );
    const finalState: StateModel = { ...state, executionSessions: applyResult.sessions, executionAdapterRequests: updatedRequests };
    writeStateModel(paths.stateFile, finalState);

    try {
      const finalSession = applyResult.sessions.find((s) => s.id === applyResult.targetSessionId)!;
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      const relatedIds = [request.id, finalSession.id, request.workUnitId];
      for (const applied of applyResult.appliedEvents) {
        const runlogEvent = buildRunlogEventForApplied(applied, finalSession, request.workUnitId, nextEventId, effectiveNow);
        if (runlogEvent) appendRunlogEvent(paths.runlogFile, runlogEvent);
      }
      appendRunlogEvent(
        paths.runlogFile,
        buildExecutionAdapterRequestImportedEvent({
          id: nextEventId(),
          timestamp: effectiveNow,
          relatedIds,
          data: { requestId: request.id, executionSessionId: finalSession.id, resultClass },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this import is idempotent.`,
        ExitCode.InvalidInput,
        "ADAPTER-IMPORT-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Imported Claude Code output for request ${request.id}: classified as "${resultClass}"; session ${applyResult.targetSessionId} is now ${applyResult.resultOutcome.sessionStatus}.`,
      completedActions: ["Validated request/session/digest", "Parsed and classified provider output", "Applied events via shared normalized-result service", "Wrote state.json", "Appended runlog event(s)"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [request.id, applyResult.targetSessionId].filter(Boolean),
      exitCode: ExitCode.Success,
      data: planData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "ADAPTER-IMPORT-UNEXPECTED-ERROR");
  }
}
