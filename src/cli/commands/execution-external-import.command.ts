import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildExecutionAdapterRequestImportedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory, buildRunlogEventForApplied } from "../../workflow/execution-runlog-event-builder.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { readExternalEvidenceFile } from "../../evidence/external-evidence-file-input.js";
import { parseAndValidateExternalJson } from "../../schema/external-evidence/limits.js";
import { sha256Hex } from "../../core/util/hash.js";
import { ExternalExecutionResultSchema } from "../../schema/external-execution-result.schema.js";
import type { NormalizedExternalExecutionResult } from "../../schema/normalized-execution-result.schema.js";
import { GENERIC_ADAPTER_ID } from "../../schema/adapter-registry.js";
import { getExecutionSessions, findExecutionSessionById } from "../../services/execution-session-service.js";
import { getExecutionAdapterRequests, findAdapterRequestById, isAdapterRequestExpired } from "../../services/execution-adapter-request-service.js";
import { applyNormalizedExecutionResult } from "../../workflow/generic-result-application-service.js";
import { findEvidenceRecordById, getEvidenceRecords } from "../../services/evidence-service.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunExecutionExternalImportOptions {
  requestId?: string;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RunExecutionExternalImportDeps {
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
 * aiqt execution external import --request <id> --from-file <path> |
 * --stdin [--preview] [--as-of <ts>] [--json] (M27R §6): the sole
 * boundary for importing a generic aiqt-external-execution-result@1
 * document. Reads exactly one bounded JSON document, validates it
 * structurally, normalizes it (adapterId generic-json@1, sourceDigest =
 * sha256 of the exact raw bytes), and applies it through the ONE shared
 * generic-result-application-service -- the exact same function the
 * refactored Claude adapter import path uses. Any failure before state
 * write produces zero mutation.
 */
export async function runExecutionExternalImport(
  ctx: CommandContext,
  options: RunExecutionExternalImportOptions,
  deps: RunExecutionExternalImportDeps = {},
): Promise<CommandResult> {
  try {
    if (!options.requestId) {
      return failure("aiqt execution external import requires --request <request-id>.", ExitCode.HumanInputRequired, "EXTERNAL-IMPORT-NO-REQUEST-ID");
    }
    if (options.fromFile && options.stdin) {
      return failure("aiqt execution external import accepts exactly one of --from-file or --stdin, not both.", ExitCode.InvalidInput, "EXTERNAL-IMPORT-CONFLICTING-INPUT");
    }
    if (!options.fromFile && !options.stdin) {
      return failure("aiqt execution external import requires --from-file <path> or --stdin.", ExitCode.HumanInputRequired, "EXTERNAL-IMPORT-NO-INPUT");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EXTERNAL-IMPORT-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXTERNAL-IMPORT-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    const adapterRequests = getExecutionAdapterRequests(state);
    const request = findAdapterRequestById(options.requestId, adapterRequests);
    if (!request) {
      return failure(`No adapter request "${options.requestId}" exists.`, ExitCode.InvalidInput, "EXTERNAL-IMPORT-UNKNOWN-REQUEST");
    }

    const sessions = getExecutionSessions(state);
    const session = findExecutionSessionById(request.executionSessionId, sessions);
    if (!session || session.workUnitId !== request.workUnitId || session.packetId !== request.packetId) {
      return failure(`Adapter request "${request.id}" references a broken session/work-unit/packet reference.`, ExitCode.InvalidInput, "EXTERNAL-IMPORT-BROKEN-REFERENCE");
    }

    let rawText: string;
    if (options.fromFile) {
      const read = readExternalEvidenceFile(options.fromFile);
      if (!read.ok) return failure(read.error, ExitCode.InvalidInput, "EXTERNAL-IMPORT-FILE-INVALID");
      rawText = read.text;
    } else {
      if (isStdinInteractiveTty(deps.stdin)) {
        return failure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "EXTERNAL-IMPORT-STDIN-TTY");
      }
      rawText = await readStdinText(deps.stdin);
      if (rawText.trim() === "") {
        return failure("Received empty input on stdin.", ExitCode.InvalidInput, "EXTERNAL-IMPORT-STDIN-EMPTY");
      }
    }
    const sourceDigest = sha256Hex(rawText);

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
      return failure(`Adapter request "${request.id}" was already imported with a different source (digest conflict).`, ExitCode.InvalidInput, "EXTERNAL-IMPORT-DIGEST-CONFLICT");
    }
    if (request.status === "invalid") {
      return failure(`Adapter request "${request.id}" is invalid and cannot be imported.`, ExitCode.WorkflowBlocked, "EXTERNAL-IMPORT-REQUEST-INVALID");
    }
    if (isAdapterRequestExpired(request, effectiveNow)) {
      return failure(`Adapter request "${request.id}" has expired.`, ExitCode.WorkflowBlocked, "EXTERNAL-IMPORT-REQUEST-EXPIRED");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseAndValidateExternalJson(rawText);
    } catch (err) {
      return failure(`Malformed or unsafe JSON payload: ${(err as Error).message}`, ExitCode.InvalidInput, "EXTERNAL-IMPORT-MALFORMED");
    }

    const resultParse = ExternalExecutionResultSchema.safeParse(parsed);
    if (!resultParse.success) {
      const firstIssue = resultParse.error.issues[0];
      return failure(
        `Result failed schema validation${firstIssue ? ` at ${firstIssue.path.join(".") || "$"}: ${firstIssue.message}` : ""}.`,
        ExitCode.InvalidInput,
        "EXTERNAL-IMPORT-SCHEMA-INVALID",
      );
    }
    const result = resultParse.data;

    if (result.requestId !== request.id) {
      return failure(`Result requestId "${result.requestId}" does not match adapter request "${request.id}".`, ExitCode.InvalidInput, "EXTERNAL-IMPORT-REQUEST-MISMATCH");
    }
    if (result.executionSessionId !== session.id) {
      return failure(`Result executionSessionId "${result.executionSessionId}" does not match session "${session.id}".`, ExitCode.InvalidInput, "EXTERNAL-IMPORT-SESSION-MISMATCH");
    }

    const normalized: NormalizedExternalExecutionResult = {
      protocolVersion: "aiqt-normalized-execution-result@1",
      adapterId: GENERIC_ADAPTER_ID,
      requestId: result.requestId,
      executionSessionId: result.executionSessionId,
      agent: result.agent,
      resultClass: result.resultClass,
      summary: result.summary,
      continuation: result.continuation,
      validationClaims: result.validationClaims,
      commitRefs: result.commitRefs,
      evidenceRefs: result.evidenceRefs,
      rollbackClaim: result.rollbackClaim,
      reportedUsage: result.reportedUsage,
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
      return failure(applyResult.error, exitCode, "EXTERNAL-IMPORT-APPLY-REJECTED");
    }

    const planData = {
      requestId: request.id,
      resultClass: normalized.resultClass,
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
        summary: `Preview: importing this result would classify as "${normalized.resultClass}" and update session ${applyResult.targetSessionId}; no state written.`,
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
          data: { requestId: request.id, executionSessionId: finalSession.id, resultClass: normalized.resultClass },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this import is idempotent.`,
        ExitCode.InvalidInput,
        "EXTERNAL-IMPORT-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Imported generic result for request ${request.id} (agent: ${normalized.agent.providerId}): classified as "${normalized.resultClass}"; session ${applyResult.targetSessionId} is now ${applyResult.resultOutcome.sessionStatus}.`,
      completedActions: ["Validated request/session/digest", "Validated generic result", "Applied events via shared normalized-result service", "Wrote state.json", "Appended runlog event(s)"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [request.id, applyResult.targetSessionId].filter(Boolean),
      exitCode: ExitCode.Success,
      data: planData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EXTERNAL-IMPORT-UNEXPECTED-ERROR");
  }
}
