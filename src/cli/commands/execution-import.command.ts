import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import type { Issue } from "../../core/output/issue.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  readRunlogEventIds,
  buildExecutionSessionOpenedEvent,
  buildExecutionSessionStatusChangedEvent,
  buildExecutionSessionBudgetUpdatedEvent,
  buildExecutionIterationStartedEvent,
  buildExecutionIterationFinishedEvent,
  buildExecutionDecisionRequestedEvent,
  buildExecutionDecisionResolvedEvent,
  buildExecutionRollbackReportedEvent,
  buildExecutionSessionSummaryUpdatedEvent,
  buildExecutionSessionReferencesAddedEvent,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { readExternalEvidenceFile } from "../../evidence/external-evidence-file-input.js";
import { parseAndValidateExternalJson } from "../../schema/external-evidence/limits.js";
import { ExecutionProtocolEnvelopeSchema, type ExecutionProtocolEvent } from "../../schema/execution-protocol-envelope.schema.js";
import { deriveEffectiveExecutionMetadata } from "../../workflow/execution-metadata-defaults.js";
import {
  getExecutionSessions,
  findNonTerminalSessionForPacket,
  findSessionsForWorkUnit,
} from "../../services/execution-session-service.js";
import { findActiveBindingForWorkUnit, findManagedWorkspaceById } from "../../services/workspace-state-service.js";
import { findEvidenceRecordById, getEvidenceRecords } from "../../services/evidence-service.js";
import { applyExecutionProtocolEnvelope, type SessionOpenContext, type AppliedEventRecord } from "../../workflow/execution-envelope-engine.js";
import type { ExecutionWorkspaceRef, ExecutionSession } from "../../schema/execution-session.schema.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { RunlogEvent } from "../../schema/runlog-event.schema.js";

export interface RunExecutionImportOptions {
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RunExecutionImportDeps {
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

function resolveWorkspaceRef(state: StateModel, workUnitId: string | null): { ok: true; ref: ExecutionWorkspaceRef } | { ok: false; error: string } {
  if (workUnitId === null) {
    return { ok: false, error: "No current work unit." };
  }
  const workUnit = state.workGraph.workUnits.find((wu) => wu.id === workUnitId);
  if (!workUnit) {
    return { ok: false, error: `Work unit ${workUnitId} does not exist.` };
  }
  const effective = deriveEffectiveExecutionMetadata(workUnit);
  const mode = effective.workspaceAssignment.mode;
  if (mode === "none") {
    return { ok: true, ref: { mode: "none" } };
  }
  if (mode === "unknown") {
    return { ok: false, error: "Work unit has no resolved workspace-assignment mode (M24 execution metadata missing or invalid)." };
  }
  const binding = findActiveBindingForWorkUnit(workUnitId, state.workspace?.workspaceBindings ?? []);
  if (!binding) {
    return { ok: false, error: `No active managed workspace binding for work unit ${workUnitId}.` };
  }
  const workspace = findManagedWorkspaceById(binding.workspaceId, state.workspace?.managedWorkspaces ?? []);
  if (!workspace || workspace.lifecycleStatus !== "ready") {
    return { ok: false, error: `Managed workspace for work unit ${workUnitId} is not ready.` };
  }
  return {
    ok: true,
    ref: { mode: "managed", workspaceId: workspace.id, workspaceBindingId: binding.id, workspaceGeneration: workspace.generation },
  };
}

function nextEventIdFactory(runlogFile: string): () => string {
  const existingIds = readRunlogEventIds(runlogFile);
  const allocated: string[] = [...existingIds];
  return () => {
    const id = nextId("EVT", allocated);
    allocated.push(id);
    return id;
  };
}

function buildRunlogEventForApplied(
  applied: AppliedEventRecord,
  finalSession: ExecutionSession,
  workUnitId: string,
  nextEventId: () => string,
  timestamp: string,
): RunlogEvent | null {
  const sessionId = finalSession.id;
  const relatedIds = [sessionId, workUnitId];
  const event = applied.event as ExecutionProtocolEvent;
  switch (event.type) {
    case "session.opened":
      return buildExecutionSessionOpenedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, providerId: finalSession.provider.providerId, workUnitId, packetId: finalSession.packetId, outcome: "created" },
      });
    case "session.status_changed": {
      const transition = [...finalSession.statusTransitions].reverse().find((t) => t.toStatus === event.toStatus && t.reason === event.reason);
      return buildExecutionSessionStatusChangedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, fromStatus: transition?.fromStatus ?? "unknown", toStatus: event.toStatus, reason: event.reason },
      });
    }
    case "session.budget_updated":
      return buildExecutionSessionBudgetUpdatedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, budgetState: finalSession.budgetState },
      });
    case "iteration.started": {
      const iteration = finalSession.iterations.find((i) => i.id === applied.focusId);
      return buildExecutionIterationStartedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, iterationId: applied.focusId ?? "", sequence: iteration?.sequence ?? 0 },
      });
    }
    case "iteration.finished":
      return buildExecutionIterationFinishedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, iterationId: applied.focusId ?? "", status: event.status },
      });
    case "decision.requested":
      return buildExecutionDecisionRequestedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, decisionId: applied.focusId ?? "" },
      });
    case "decision.resolved":
      return buildExecutionDecisionResolvedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, decisionId: applied.focusId ?? "" },
      });
    case "rollback.reported":
      return buildExecutionRollbackReportedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId, rollbackId: applied.focusId ?? "" },
      });
    case "session.summary_updated":
      return buildExecutionSessionSummaryUpdatedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: { sessionId },
      });
    case "session.references_added":
      return buildExecutionSessionReferencesAddedEvent({
        id: nextEventId(),
        timestamp,
        relatedIds,
        data: {
          sessionId,
          commitRefCount: event.commitRefs?.length ?? 0,
          evidenceRefCount: event.evidenceRefs?.length ?? 0,
        },
      });
  }
  return null;
}

/**
 * aiqt execution import --from-file <path> | --stdin [--preview] [--as-of
 * <ts>] [--json] (M26 §4.2/§4.3): the sole boundary for importing a
 * bounded execution-protocol event envelope. Reads exactly one JSON
 * document, validates it against the fixed protocol schema, applies its
 * events atomically through the pure envelope engine, and either reports
 * the resulting plan (--preview, zero mutation) or persists it (state
 * written before runlog append, matching the established M22/M23/M25
 * write-then-append-runlog sequence). Never executes a shell command,
 * spawns a process, or performs network I/O.
 */
export async function runExecutionImport(
  ctx: CommandContext,
  options: RunExecutionImportOptions,
  deps: RunExecutionImportDeps = {},
): Promise<CommandResult> {
  try {
    if (options.fromFile && options.stdin) {
      return failure("aiqt execution import accepts exactly one of --from-file or --stdin, not both.", ExitCode.InvalidInput, "EXECUTION-IMPORT-CONFLICTING-INPUT");
    }
    if (!options.fromFile && !options.stdin) {
      return failure("aiqt execution import requires --from-file <path> or --stdin.", ExitCode.HumanInputRequired, "EXECUTION-IMPORT-NO-INPUT");
    }

    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EXECUTION-IMPORT-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    let rawText: string;
    if (options.fromFile) {
      const read = readExternalEvidenceFile(options.fromFile);
      if (!read.ok) return failure(read.error, ExitCode.InvalidInput, "EXECUTION-IMPORT-FILE-INVALID");
      rawText = read.text;
    } else {
      if (isStdinInteractiveTty(deps.stdin)) {
        return failure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "EXECUTION-IMPORT-STDIN-TTY");
      }
      rawText = await readStdinText(deps.stdin);
      if (rawText.trim() === "") {
        return failure("Received empty input on stdin.", ExitCode.InvalidInput, "EXECUTION-IMPORT-STDIN-EMPTY");
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseAndValidateExternalJson(rawText);
    } catch (err) {
      return failure(`Malformed or unsafe JSON payload: ${(err as Error).message}`, ExitCode.InvalidInput, "EXECUTION-IMPORT-MALFORMED");
    }

    const envelopeResult = ExecutionProtocolEnvelopeSchema.safeParse(parsed);
    if (!envelopeResult.success) {
      const firstIssue = envelopeResult.error.issues[0];
      return failure(
        `Envelope failed schema validation${firstIssue ? ` at ${firstIssue.path.join(".") || "$"}: ${firstIssue.message}` : ""}.`,
        ExitCode.InvalidInput,
        "EXECUTION-IMPORT-SCHEMA-INVALID",
      );
    }
    const envelope = envelopeResult.data;

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXECUTION-IMPORT-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    const currentWorkUnitId = state.currentWorkUnitId;
    const currentWorkUnit = currentWorkUnitId ? state.workGraph.workUnits.find((wu) => wu.id === currentWorkUnitId) : undefined;
    const currentPacketId = state.lastAgentPacket?.workUnitId === currentWorkUnitId ? (state.lastAgentPacket?.id ?? null) : null;
    const packetHasCheckpoint = currentPacketId !== null && state.checkpoints.some((cp) => cp.packetId === currentPacketId);
    const sessions = getExecutionSessions(state);
    const workspaceRefResolution = resolveWorkspaceRef(state, currentWorkUnitId);

    const needsWorkspaceRef = envelope.events[0]?.type === "session.opened";
    if (needsWorkspaceRef && !workspaceRefResolution.ok) {
      return failure(workspaceRefResolution.error, ExitCode.InvalidInput, "EXECUTION-IMPORT-WORKSPACE-REF-INVALID");
    }

    const openContext: SessionOpenContext = {
      projectId: project.project.id,
      currentWorkUnitId,
      currentWorkUnitInProgress: currentWorkUnit?.status === "in_progress",
      currentPacketId,
      packetHasCheckpoint,
      workspaceRef: workspaceRefResolution.ok ? workspaceRefResolution.ref : { mode: "none" },
      sessionsForWorkUnitCount: currentWorkUnitId ? findSessionsForWorkUnit(currentWorkUnitId, sessions).length : 0,
      totalSessionsCount: sessions.length,
      nonTerminalSessionExistsForPacket: currentPacketId !== null && findNonTerminalSessionForPacket(currentPacketId, sessions) !== undefined,
    };

    const evidenceRecords = getEvidenceRecords(state);
    const result = applyExecutionProtocolEnvelope({
      sessions,
      envelope,
      effectiveNow,
      openContext,
      evidenceExists: (evidenceId) => findEvidenceRecordById(evidenceId, evidenceRecords) !== undefined,
    });

    if (!result.ok) {
      const exitCode = result.category === "blocked" ? ExitCode.WorkflowBlocked : ExitCode.InvalidInput;
      return failure(result.error, exitCode, "EXECUTION-IMPORT-REJECTED");
    }

    const planData = {
      providerId: envelope.providerId,
      sessionClientKey: envelope.sessionClientKey,
      outcome: result.outcome,
      targetSessionId: result.targetSessionId,
      appliedEventCount: result.appliedEventCount,
      noOpEventCount: result.noOpEventCount,
      wouldChangeState: result.changed,
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: result.changed
          ? `Preview: importing this envelope would result in a "${result.outcome}" session ${result.targetSessionId} (${result.appliedEventCount} event(s) applied).`
          : `Preview: this envelope resolves to a no-op (${result.noOpEventCount} already-applied event(s)) -- no state change.`,
        exitCode: ExitCode.Success,
        data: planData,
      });
    }

    if (!result.changed) {
      return makeResult({
        status: "passed",
        action: "execution",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Envelope already applied (idempotent no-op, ${result.noOpEventCount} event(s)) -- no new state written.`,
        exitCode: ExitCode.Success,
        data: planData,
      });
    }

    const finalState: StateModel = { ...state, executionSessions: result.sessions };
    writeStateModel(paths.stateFile, finalState);

    try {
      const finalSession = result.sessions.find((s) => s.id === result.targetSessionId)!;
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      for (const applied of result.appliedEvents) {
        const runlogEvent = buildRunlogEventForApplied(applied, finalSession, currentWorkUnitId ?? "", nextEventId, effectiveNow);
        if (runlogEvent) appendRunlogEvent(paths.runlogFile, runlogEvent);
      }
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this import is idempotent.`,
        ExitCode.InvalidInput,
        "EXECUTION-IMPORT-RUNLOG-APPEND-FAILED",
      );
    }

    const warningIssues: Issue[] = [];
    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Execution session ${result.targetSessionId} ${result.outcome} (${result.appliedEventCount} event(s) applied).`,
      completedActions: ["Validated envelope", "Applied events via candidate state", "Wrote state.json", "Appended runlog event(s)"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [result.targetSessionId ?? ""].filter(Boolean),
      warnings: warningIssues,
      exitCode: ExitCode.Success,
      data: planData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EXECUTION-IMPORT-UNEXPECTED-ERROR");
  }
}
