import {
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
} from "../state/runlog-store.js";
import { nextId } from "../state/ids.js";
import type { AppliedEventRecord } from "./execution-envelope-engine.js";
import type { ExecutionProtocolEvent } from "../schema/execution-protocol-envelope.schema.js";
import type { ExecutionSession } from "../schema/execution-session.schema.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";

/**
 * M26 §4.2/M27 §5.1: allocates sequential EVT-* runlog event IDs starting
 * from the highest ID already present in the runlog. Shared by M26's
 * `execution import` and M27's Claude Code adapter `import` command, so
 * both draw from one monotonic sequence rather than two independent
 * counters that could collide.
 */
export function nextEventIdFactory(runlogFile: string): () => string {
  const existingIds = readRunlogEventIds(runlogFile);
  const allocated: string[] = [...existingIds];
  return () => {
    const id = nextId("EVT", allocated);
    allocated.push(id);
    return id;
  };
}

/**
 * M26 §4.2/M27 §5.1: translates one applied (non-no-op) envelope event
 * into its corresponding bounded runlog event. Shared by M26's `execution
 * import` and M27's Claude Code adapter `import` command -- never a
 * second, parallel translation of the same ten protocol event types.
 */
export function buildRunlogEventForApplied(
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
