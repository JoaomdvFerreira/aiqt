import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import {
  getExecutionSessions,
  findExecutionSessionById,
  findSessionsForWorkUnit,
} from "../../services/execution-session-service.js";
import { isTerminalSessionStatus, type ExecutionSession } from "../../schema/execution-session.schema.js";
import { computeStaleDeadline } from "../../workflow/execution-stale-detection.js";

export interface RunExecutionStatusOptions {
  sessionId?: string;
  workUnitId?: string;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "execution", area: "execution", summary, exitCode, issueId });
}

/** Advisory-only recommended next action -- never authorizes or performs anything itself. */
function recommendedAction(session: ExecutionSession, hasCheckpoint: boolean): string {
  const openDecisions = session.decisions.filter((d) => d.status === "open").length;
  if (openDecisions > 0) return `Resolve ${openDecisions} open decision(s) (aiqt execution import a decision.resolved event).`;
  if (session.stopCondition === "budget_exceeded" || session.stopCondition === "budget_reached") {
    return "Review budget usage; import a session.budget_updated event to continue.";
  }
  if (isTerminalSessionStatus(session.status) && !hasCheckpoint) {
    return "Session is terminal and awaiting checkpoint (aiqt checkpoint).";
  }
  if (session.status === "stale") {
    return "Session is stale; import a session.status_changed event to resume, or leave as historical record.";
  }
  return "No action needed.";
}

function summarizeSession(session: ExecutionSession, hasCheckpoint: boolean) {
  return {
    id: session.id,
    providerId: session.provider.providerId,
    workUnitId: session.workUnitId,
    packetId: session.packetId,
    status: session.status,
    budgetState: session.budgetState,
    stopCondition: session.stopCondition ?? null,
    openDecisionCount: session.decisions.filter((d) => d.status === "open").length,
    iterationCount: session.iterations.length,
    runningIterationCount: session.iterations.filter((i) => i.status === "running").length,
    commitRefCount: session.commitRefs.length,
    evidenceRefCount: session.evidenceRefs.length,
    staleDeadline: computeStaleDeadline(session),
    terminalAt: session.terminalAt ?? null,
    recommendedAction: recommendedAction(session, hasCheckpoint),
  };
}

/** aiqt execution status [--session <id>|--work-unit <id>] [--json] (M26 §5.4): read-only. Never mutates state or runlog. */
export function runExecutionStatus(ctx: CommandContext, options: RunExecutionStatusOptions): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXECUTION-STATUS-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const sessions = getExecutionSessions(state);
  const hasCheckpointFor = (packetId: string) => state.checkpoints.some((cp) => cp.packetId === packetId);

  if (options.sessionId) {
    const session = findExecutionSessionById(options.sessionId, sessions);
    if (!session) {
      return failure(`Execution session ${options.sessionId} does not exist.`, ExitCode.InvalidInput, "EXECUTION-STATUS-UNKNOWN-SESSION");
    }
    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Execution session ${session.id}: ${session.status} (${session.iterations.length} iteration(s), ${session.decisions.filter((d) => d.status === "open").length} open decision(s)).`,
      exitCode: ExitCode.Success,
      data: {
        session: summarizeSession(session, hasCheckpointFor(session.packetId)),
        iterations: session.iterations,
        decisions: session.decisions,
        rollbackRecords: session.rollbackRecords,
        commitRefs: session.commitRefs,
        evidenceRefs: session.evidenceRefs,
        learningSummary: session.learningSummary ?? null,
      },
    });
  }

  const scoped = options.workUnitId ? findSessionsForWorkUnit(options.workUnitId, sessions) : sessions;
  const summaries = scoped.map((s) => summarizeSession(s, hasCheckpointFor(s.packetId)));
  const nonTerminalCount = scoped.filter((s) => !isTerminalSessionStatus(s.status)).length;
  const openDecisionCount = scoped.reduce((sum, s) => sum + s.decisions.filter((d) => d.status === "open").length, 0);

  return makeResult({
    status: "passed",
    action: "execution",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${scoped.length} execution session(s) (${nonTerminalCount} non-terminal, ${openDecisionCount} open decision(s)).`,
    exitCode: ExitCode.Success,
    data: { totalSessions: scoped.length, nonTerminalCount, openDecisionCount, sessions: summaries },
  });
}
