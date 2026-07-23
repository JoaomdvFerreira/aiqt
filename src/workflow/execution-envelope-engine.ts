import type {
  ExecutionSession,
  ExecutionIteration,
  ExecutionDecision,
  ExecutionRollbackRecord,
  ExecutionCommitRef,
  ExecutionWorkspaceRef,
  ExecutionBudgets,
  ExecutionBudgetState,
} from "../schema/execution-session.schema.js";
import {
  isTerminalSessionStatus,
  PROTOCOL_VERSION,
  MAX_SESSIONS,
  MAX_SESSIONS_PER_WORK_UNIT,
} from "../schema/execution-session.schema.js";
import type { ExecutionProtocolEnvelope, ExecutionProtocolEvent } from "../schema/execution-protocol-envelope.schema.js";
import { computeEventDigest } from "./execution-event-digest.js";
import { deriveExecutionSessionIdentity } from "./execution-session-identity.js";
import { isValidSessionStatusTransition } from "./execution-session-transitions.js";
import { nextId } from "../state/ids.js";

const TERMINAL_GRACE_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export interface SessionOpenContext {
  projectId: string;
  currentWorkUnitId: string | null;
  currentWorkUnitInProgress: boolean;
  currentPacketId: string | null;
  packetHasCheckpoint: boolean;
  workspaceRef: ExecutionWorkspaceRef;
  sessionsForWorkUnitCount: number;
  totalSessionsCount: number;
  nonTerminalSessionExistsForPacket: boolean;
}

export interface ApplyEnvelopeParams {
  sessions: readonly ExecutionSession[];
  envelope: ExecutionProtocolEnvelope;
  effectiveNow: string;
  openContext: SessionOpenContext;
  evidenceExists: (evidenceId: string) => boolean;
}

export interface AppliedEventRecord {
  event: ExecutionProtocolEvent;
  focusId?: string;
}

export interface ApplyEnvelopeSuccess {
  ok: true;
  changed: boolean;
  sessions: ExecutionSession[];
  targetSessionId: string | null;
  outcome: "created" | "updated" | "no_op";
  appliedEventCount: number;
  noOpEventCount: number;
  appliedEvents: AppliedEventRecord[];
}

export interface ApplyEnvelopeFailure {
  ok: false;
  category: "invalid" | "blocked";
  error: string;
}

export type ApplyEnvelopeResult = ApplyEnvelopeSuccess | ApplyEnvelopeFailure;

function idAllocator(prefix: string, existingIds: readonly string[]): () => string {
  let allocated = [...existingIds];
  return () => {
    const id = nextId(prefix, allocated);
    allocated = [...allocated, id];
    return id;
  };
}

function collectIds(sessions: readonly ExecutionSession[], extract: (s: ExecutionSession) => string[]): string[] {
  return sessions.flatMap(extract);
}

function isWithinTerminalGraceWindow(terminalAt: string, effectiveNow: string): boolean {
  const terminalMs = Date.parse(terminalAt);
  const nowMs = Date.parse(effectiveNow);
  if (Number.isNaN(terminalMs) || Number.isNaN(nowMs)) return false;
  return nowMs <= terminalMs + TERMINAL_GRACE_WINDOW_SECONDS * 1000;
}

function recomputeBudgetState(budgets: ExecutionBudgets | undefined, iterations: readonly ExecutionIteration[]): ExecutionBudgetState {
  if (!budgets || Object.keys(budgets).length === 0) return "not_configured";
  const iterationCount = iterations.length;
  const totalTokens = iterations.reduce((sum, i) => sum + (i.reportedTokens ?? 0), 0);
  const totalDurationSeconds = iterations.reduce((sum, i) => sum + (i.reportedDurationSeconds ?? 0), 0);

  const ratios: number[] = [];
  if (budgets.maxIterations !== undefined) ratios.push(iterationCount / budgets.maxIterations);
  if (budgets.maxTokens !== undefined) ratios.push(totalTokens / budgets.maxTokens);
  if (budgets.maxDurationSeconds !== undefined) ratios.push(totalDurationSeconds / budgets.maxDurationSeconds);
  if (ratios.length === 0) return "not_configured";

  const maxRatio = Math.max(...ratios);
  if (maxRatio > 1) return "exceeded";
  if (maxRatio === 1) return "reached";
  return "within";
}

interface EventApplyContext {
  effectiveNow: string;
  openContext: SessionOpenContext;
  evidenceExists: (evidenceId: string) => boolean;
  allocateIterationId: () => string;
  allocateDecisionId: () => string;
  allocateRollbackId: () => string;
  allocateCommitRefId: () => string;
}

interface EventApplyResult {
  ok: true;
  session: ExecutionSession;
  changed: boolean;
  /** The ID of any record this event newly created (iteration/decision/rollback), for runlog construction by the caller. */
  focusId?: string;
}
interface EventApplyFailure {
  ok: false;
  category: "invalid" | "blocked";
  error: string;
}

function buildNewSession(event: Extract<ExecutionProtocolEvent, { type: "session.opened" }>, envelope: ExecutionProtocolEnvelope, ctx: EventApplyContext): EventApplyResult | EventApplyFailure {
  const oc = ctx.openContext;
  if (oc.currentWorkUnitId === null || !oc.currentWorkUnitInProgress) {
    return { ok: false, category: "invalid", error: "Session open requires the current Work Unit to exist and be in_progress." };
  }
  if (oc.currentPacketId === null) {
    return { ok: false, category: "invalid", error: "Session open requires a current packet." };
  }
  if (oc.packetHasCheckpoint) {
    return { ok: false, category: "invalid", error: "Session open requires the current packet to have no checkpoint yet." };
  }
  if (oc.nonTerminalSessionExistsForPacket) {
    return { ok: false, category: "invalid", error: "Another non-terminal execution session already exists for the current packet." };
  }
  if (oc.totalSessionsCount >= MAX_SESSIONS) {
    return { ok: false, category: "blocked", error: `State/session cap reached (max_sessions=${MAX_SESSIONS}).` };
  }
  if (oc.sessionsForWorkUnitCount >= MAX_SESSIONS_PER_WORK_UNIT) {
    return { ok: false, category: "blocked", error: `State/session cap reached (max_sessions_per_work_unit=${MAX_SESSIONS_PER_WORK_UNIT}).` };
  }

  const workspaceMode = oc.workspaceRef.mode;
  const id = deriveExecutionSessionIdentity({
    projectId: oc.projectId,
    workUnitId: oc.currentWorkUnitId,
    packetId: oc.currentPacketId,
    workspaceMode,
    workspaceIdOrNone: oc.workspaceRef.workspaceId ?? null,
    workspaceGenerationOrZero: oc.workspaceRef.workspaceGeneration ?? 0,
    providerId: envelope.providerId,
    sessionClientKey: envelope.sessionClientKey,
  });

  const budgetState = recomputeBudgetState(event.budgets, []);
  const session: ExecutionSession = {
    id,
    protocolVersion: PROTOCOL_VERSION,
    sessionClientKey: envelope.sessionClientKey,
    provider: { providerId: envelope.providerId, externalSessionId: event.externalSessionId },
    workUnitId: oc.currentWorkUnitId,
    packetId: oc.currentPacketId,
    workspaceRef: oc.workspaceRef,
    status: "planned",
    budgets: event.budgets,
    budgetState,
    iterations: [],
    decisions: [],
    rollbackRecords: [],
    commitRefs: [],
    evidenceRefs: [],
    statusTransitions: [],
    eventReceipts: [{ eventId: event.eventId, digest: computeEventDigest(event), appliedAt: ctx.effectiveNow }],
    createdAt: ctx.effectiveNow,
    updatedAt: ctx.effectiveNow,
    lastActivityAt: ctx.effectiveNow,
  };
  return { ok: true, session, changed: true, focusId: session.id };
}

/**
 * M26 §3.4/§3.5: a bounded, derived description of what is currently
 * blocking new iteration starts (and, transitively, checkpoint via
 * WU26-04's integration) -- recomputed from canonical decisions/budget
 * state on every mutation, never stored as independent truth.
 */
function recomputeStopCondition(session: ExecutionSession): string | undefined {
  if (session.decisions.some((d) => d.status === "open")) return "open_decision";
  if (session.budgetState === "exceeded") return "budget_exceeded";
  if (session.budgetState === "reached") return "budget_reached";
  return undefined;
}

function withReceipt(session: ExecutionSession, event: ExecutionProtocolEvent, effectiveNow: string): ExecutionSession {
  return {
    ...session,
    stopCondition: recomputeStopCondition(session),
    eventReceipts: [...session.eventReceipts, { eventId: event.eventId, digest: computeEventDigest(event), appliedAt: effectiveNow }],
    updatedAt: effectiveNow,
    lastActivityAt: effectiveNow,
  };
}

function applyEventToExistingSession(
  session: ExecutionSession,
  event: ExecutionProtocolEvent,
  ctx: EventApplyContext,
): EventApplyResult | EventApplyFailure {
  const terminal = isTerminalSessionStatus(session.status);

  if (terminal) {
    if (event.type !== "session.summary_updated" && event.type !== "session.references_added") {
      return { ok: false, category: "invalid", error: `Session ${session.id} is terminal and does not accept ${event.type} events.` };
    }
    if (session.terminalAt === undefined || !isWithinTerminalGraceWindow(session.terminalAt, ctx.effectiveNow)) {
      return { ok: false, category: "blocked", error: `Terminal grace window for session ${session.id} has expired.` };
    }
  }

  switch (event.type) {
    case "session.opened": {
      return { ok: true, session: withReceipt(session, event, ctx.effectiveNow), changed: false };
    }
    case "session.status_changed": {
      if (!isValidSessionStatusTransition(session.status, event.toStatus)) {
        return { ok: false, category: "invalid", error: `Transition ${session.status} -> ${event.toStatus} is not allowed.` };
      }
      if (event.toStatus === "completed") {
        if (session.iterations.some((i) => i.status === "running")) {
          return { ok: false, category: "invalid", error: "completed is invalid while an iteration is running." };
        }
        if (session.decisions.some((d) => d.status === "open")) {
          return { ok: false, category: "invalid", error: "completed is invalid while a decision remains open." };
        }
      }
      const nowTerminal = isTerminalSessionStatus(event.toStatus);
      const updated: ExecutionSession = {
        ...session,
        status: event.toStatus,
        terminalAt: nowTerminal ? ctx.effectiveNow : session.terminalAt,
        statusTransitions: [
          ...session.statusTransitions,
          { fromStatus: session.status, toStatus: event.toStatus, reason: event.reason, at: ctx.effectiveNow },
        ],
      };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true };
    }
    case "session.budget_updated": {
      const budgetState = recomputeBudgetState(event.budgets, session.iterations);
      const updated: ExecutionSession = { ...session, budgets: event.budgets, budgetState };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true };
    }
    case "iteration.started": {
      // M26 §3.4/§3.5/§6: these are all "valid but currently blocked"
      // conditions (exit 2), not structural invalidity -- once the
      // running iteration finishes, the decision resolves, or the
      // budget is revised, a new iteration.started becomes acceptable
      // again.
      if (session.iterations.some((i) => i.status === "running")) {
        return { ok: false, category: "blocked", error: "At most one iteration may be running per session." };
      }
      if (session.decisions.some((d) => d.status === "open")) {
        return { ok: false, category: "blocked", error: "An open decision blocks new iterations." };
      }
      if (session.budgetState === "reached" || session.budgetState === "exceeded") {
        return { ok: false, category: "blocked", error: `Budget stop condition (${session.budgetState}) blocks new iterations.` };
      }
      const iteration: ExecutionIteration = {
        id: ctx.allocateIterationId(),
        providerIterationKey: event.providerIterationKey,
        sequence: session.iterations.length + 1,
        status: "running",
        objectiveSummary: event.objectiveSummary,
        startedAt: event.at,
        commitRefs: [],
        evidenceRefs: [],
      };
      const updated: ExecutionSession = { ...session, iterations: [...session.iterations, iteration] };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true, focusId: iteration.id };
    }
    case "iteration.finished": {
      const idx = session.iterations.findIndex(
        (i) => i.providerIterationKey === event.providerIterationKey && i.status === "running",
      );
      if (idx === -1) {
        return { ok: false, category: "invalid", error: `No running iteration matches providerIterationKey "${event.providerIterationKey}".` };
      }
      for (const evidenceId of event.evidenceRefs ?? []) {
        if (!ctx.evidenceExists(evidenceId)) {
          return { ok: false, category: "invalid", error: `Evidence reference "${evidenceId}" does not resolve.` };
        }
      }
      const commitRefs: ExecutionCommitRef[] = (event.commitRefs ?? []).map((c) => ({
        id: ctx.allocateCommitRefId(),
        sha: c.sha,
        message: c.message,
        reportedAt: event.at,
      }));
      const updatedIteration: ExecutionIteration = {
        ...session.iterations[idx]!,
        status: event.status,
        resultSummary: event.resultSummary,
        finishedAt: event.at,
        reportedTokens: event.reportedTokens,
        reportedDurationSeconds: event.reportedDurationSeconds,
        commitRefs,
        evidenceRefs: event.evidenceRefs ?? [],
      };
      const iterations = [...session.iterations];
      iterations[idx] = updatedIteration;
      const budgetState = recomputeBudgetState(session.budgets, iterations);
      const updated: ExecutionSession = { ...session, iterations, budgetState };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true, focusId: updatedIteration.id };
    }
    case "decision.requested": {
      const decision: ExecutionDecision = {
        id: ctx.allocateDecisionId(),
        providerDecisionKey: event.providerDecisionKey,
        status: "open",
        title: event.title,
        question: event.question,
        contextSummary: event.contextSummary,
        options: event.options ?? [],
        requestedAt: event.at,
      };
      // M26 §3.4: an open decision places a non-terminal session in
      // blocked -- only when that transition is actually reachable from
      // the current status (running/paused/stale -> blocked are all
      // allowed; "planned" has no path to blocked in the §4.1 table, so
      // the decision is still recorded but the status is left alone;
      // resolving a decision never auto-resumes the session).
      const canAutoBlock = session.status !== "blocked" && isValidSessionStatusTransition(session.status, "blocked");
      const updated: ExecutionSession = {
        ...session,
        decisions: [...session.decisions, decision],
        status: canAutoBlock ? "blocked" : session.status,
        statusTransitions: canAutoBlock
          ? [...session.statusTransitions, { fromStatus: session.status, toStatus: "blocked" as const, reason: "open decision requested", at: ctx.effectiveNow }]
          : session.statusTransitions,
      };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true, focusId: decision.id };
    }
    case "decision.resolved": {
      const idx = session.decisions.findIndex(
        (d) => d.providerDecisionKey === event.providerDecisionKey && d.status === "open",
      );
      if (idx === -1) {
        return { ok: false, category: "invalid", error: `No open decision matches providerDecisionKey "${event.providerDecisionKey}".` };
      }
      const updatedDecision: ExecutionDecision = {
        ...session.decisions[idx]!,
        status: "resolved",
        resolvedAt: event.at,
        selectedOption: event.selectedOption,
        resolutionSummary: event.resolutionSummary,
      };
      const decisions = [...session.decisions];
      decisions[idx] = updatedDecision;
      const updated: ExecutionSession = { ...session, decisions };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true, focusId: updatedDecision.id };
    }
    case "rollback.reported": {
      const record: ExecutionRollbackRecord = {
        id: ctx.allocateRollbackId(),
        providerRollbackKey: event.providerRollbackKey,
        reportedAt: event.at,
        targetRef: event.targetRef,
        reasonSummary: event.reasonSummary,
        scope: event.scope,
      };
      const updated: ExecutionSession = { ...session, rollbackRecords: [...session.rollbackRecords, record] };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true, focusId: record.id };
    }
    case "session.summary_updated": {
      const updated: ExecutionSession = { ...session, learningSummary: event.learningSummary };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true };
    }
    case "session.references_added": {
      for (const evidenceId of event.evidenceRefs ?? []) {
        if (!ctx.evidenceExists(evidenceId)) {
          return { ok: false, category: "invalid", error: `Evidence reference "${evidenceId}" does not resolve.` };
        }
      }
      const newCommitRefs: ExecutionCommitRef[] = (event.commitRefs ?? []).map((c) => ({
        id: ctx.allocateCommitRefId(),
        sha: c.sha,
        message: c.message,
        reportedAt: event.at,
      }));
      const updated: ExecutionSession = {
        ...session,
        commitRefs: [...session.commitRefs, ...newCommitRefs],
        evidenceRefs: [...session.evidenceRefs, ...(event.evidenceRefs ?? [])],
      };
      return { ok: true, session: withReceipt(updated, event, ctx.effectiveNow), changed: true };
    }
  }
}

/**
 * M26 §4.2/§4.3: applies one envelope's events, in array order, through a
 * single in-memory candidate session -- any invalid event rejects the
 * entire envelope with no mutation. Same scoped (providerId,
 * sessionClientKey, eventId) with the same digest is a no-op; a different
 * digest is a conflict (exit 3 at the caller). Never performs I/O.
 */
export function applyExecutionProtocolEnvelope(params: ApplyEnvelopeParams): ApplyEnvelopeResult {
  const { sessions, envelope, effectiveNow, openContext, evidenceExists } = params;

  const existingIndex = sessions.findIndex(
    (s) => s.provider.providerId === envelope.providerId && s.sessionClientKey === envelope.sessionClientKey,
  );
  let workingSession: ExecutionSession | null = existingIndex === -1 ? null : sessions[existingIndex]!;
  const outcomeIsNew = workingSession === null;

  const ctx: EventApplyContext = {
    effectiveNow,
    openContext,
    evidenceExists,
    allocateIterationId: idAllocator("XI", collectIds(sessions, (s) => s.iterations.map((i) => i.id))),
    allocateDecisionId: idAllocator("XD", collectIds(sessions, (s) => s.decisions.map((d) => d.id))),
    allocateRollbackId: idAllocator("XR", collectIds(sessions, (s) => s.rollbackRecords.map((r) => r.id))),
    allocateCommitRefId: idAllocator(
      "XC",
      collectIds(sessions, (s) => [...s.commitRefs.map((c) => c.id), ...s.iterations.flatMap((i) => i.commitRefs.map((c) => c.id))]),
    ),
  };

  let appliedEventCount = 0;
  let noOpEventCount = 0;
  let anyChange = false;
  const appliedEvents: AppliedEventRecord[] = [];

  for (const event of envelope.events) {
    if (workingSession !== null) {
      const receipt = workingSession.eventReceipts.find((r) => r.eventId === event.eventId);
      if (receipt) {
        const digest = computeEventDigest(event);
        if (receipt.digest === digest) {
          noOpEventCount += 1;
          continue;
        }
        return { ok: false, category: "invalid", error: `Event "${event.eventId}" was already applied with different content (digest conflict).` };
      }
    }

    if (workingSession === null) {
      if (event.type !== "session.opened") {
        return { ok: false, category: "invalid", error: `No session exists for provider "${envelope.providerId}" / sessionClientKey "${envelope.sessionClientKey}"; the first event must be session.opened.` };
      }
      const result = buildNewSession(event, envelope, ctx);
      if (!result.ok) return result;
      workingSession = result.session;
      appliedEventCount += 1;
      anyChange = true;
      appliedEvents.push({ event, focusId: result.focusId });
      continue;
    }

    const result = applyEventToExistingSession(workingSession, event, ctx);
    if (!result.ok) return result;
    workingSession = result.session;
    if (result.changed) {
      appliedEventCount += 1;
      anyChange = true;
      appliedEvents.push({ event, focusId: result.focusId });
    } else {
      noOpEventCount += 1;
    }
  }

  if (!anyChange || workingSession === null) {
    return {
      ok: true,
      changed: false,
      sessions: [...sessions],
      targetSessionId: workingSession?.id ?? null,
      outcome: "no_op",
      appliedEventCount,
      noOpEventCount,
      appliedEvents: [],
    };
  }

  const finalSessions = outcomeIsNew
    ? [...sessions, workingSession]
    : sessions.map((s, i) => (i === existingIndex ? workingSession! : s));

  return {
    ok: true,
    changed: true,
    sessions: finalSessions,
    targetSessionId: workingSession.id,
    outcome: outcomeIsNew ? "created" : "updated",
    appliedEventCount,
    noOpEventCount,
    appliedEvents,
  };
}
