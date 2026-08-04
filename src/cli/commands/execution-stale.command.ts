import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, readRunlogEventIds, buildExecutionSessionStatusChangedEvent } from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { getExecutionSessions } from "../../services/execution-session-service.js";
import { findStaleEligibleSessions, applyStaleTransitions } from "../../workflow/execution-stale-detection.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunExecutionStaleOptions {
  apply?: boolean;
  asOf?: string;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "execution", area: "execution", summary, exitCode, issueId });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * aiqt execution stale [--preview|--apply] [--as-of <ts>] [--json] (M26
 * §4.4): default (no --apply) is preview. Apply transitions every
 * currently-eligible non-terminal session to `stale`, recording
 * "stale_timeout" -- never cancels a provider, releases a workspace, or
 * changes a Work Unit. Deterministic via --as-of for testing.
 */
export function runExecutionStale(ctx: CommandContext, options: RunExecutionStaleOptions): CommandResult {
  if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
    return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EXECUTION-STALE-INVALID-AS-OF");
  }
  const effectiveNow = options.asOf ?? new Date().toISOString();

  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXECUTION-STALE-NO-PROJECT");
  }
  const { paths, state } = loadProject(ctx);
  const sessions = getExecutionSessions(state);
  const eligible = findStaleEligibleSessions(sessions, effectiveNow);

  if (!options.apply) {
    return makeResult({
      status: "passed",
      action: "execution",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Preview: ${eligible.length} session(s) eligible for stale transition.`,
      exitCode: ExitCode.Success,
      data: { apply: false, eligible },
    });
  }

  if (eligible.length === 0) {
    return failure("No stale-eligible session exists.", ExitCode.WorkflowBlocked, "EXECUTION-STALE-NONE-ELIGIBLE");
  }

  const { sessions: updatedSessions, transitionedSessionIds } = applyStaleTransitions(sessions, effectiveNow);
  const finalState: StateModel = { ...state, executionSessions: updatedSessions };
  writeStateModel(paths.stateFile, finalState);

  // M26-R12: state is already authoritative at this point -- a failure
  // appending the runlog must not be allowed to crash uncaught (which
  // would skip clean CommandResult output); it returns exit 3 with state
  // remaining authoritative, and a retry is idempotent (findStaleEligibleSessions
  // will find nothing left eligible once these sessions are already stale).
  try {
    const existingIds = readRunlogEventIds(paths.runlogFile);
    const allocated = [...existingIds];
    const nextEventId = () => {
      const id = nextId("EVT", allocated);
      allocated.push(id);
      return id;
    };
    for (const sessionId of transitionedSessionIds) {
      const session = updatedSessions.find((s) => s.id === sessionId)!;
      const lastTransition = session.statusTransitions[session.statusTransitions.length - 1]!;
      appendRunlogEvent(
        paths.runlogFile,
        buildExecutionSessionStatusChangedEvent({
          id: nextEventId(),
          timestamp: effectiveNow,
          relatedIds: [sessionId, session.workUnitId],
          data: { sessionId, fromStatus: lastTransition.fromStatus, toStatus: "stale", reason: "stale_timeout" },
        }),
      );
    }
  } catch (err) {
    return failure(
      `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying is safe.`,
      ExitCode.InvalidInput,
      "EXECUTION-STALE-RUNLOG-APPEND-FAILED",
    );
  }

  return makeResult({
    status: "passed",
    action: "execution",
    projectStatus: finalState.projectStatus,
    currentMilestoneId: finalState.currentMilestoneId,
    currentWorkUnitId: finalState.currentWorkUnitId,
    summary: `Transitioned ${transitionedSessionIds.length} session(s) to stale.`,
    completedActions: ["Wrote state.json", "Appended runlog event(s)"],
    changedFiles: [paths.stateFile, paths.runlogFile],
    affectedItems: transitionedSessionIds,
    exitCode: ExitCode.Success,
    data: { apply: true, transitionedSessionIds },
  });
}
