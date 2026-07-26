import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildEvidenceGateAdvisoryObservationRecordedEvent, readRunlogEventIds } from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { runCheckpointAdvisory } from "../../workflow/checkpoint-advisory-integration.js";
import { upsertCheckpointAdvisory } from "../../workflow/checkpoint-advisory-state.js";
import { buildEvidenceAdvisorySummary } from "../../workflow/checkpoint-advisory-visibility.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateAdvisoryRefreshOptions {
  checkpointId?: string;
  asOf?: string;
  preview?: boolean;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return makeResult({
    status: exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed",
    action: "evidence",
    summary,
    exitCode,
    blockingIssues: [{ id: issueId, severity: "high", area: "evidence-gate", message: summary, agentCanFix: false }],
  });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * aiqt evidence gate advisory refresh --checkpoint <id> [--as-of <ts>]
 * [--preview] [--json] (M29 §3.4): the sole explicit, on-demand advisory
 * re-evaluation boundary. Never changes checkpoint completion. Reuses the
 * same runCheckpointAdvisory pipeline as automatic checkpoint evaluation --
 * no second evaluator, no second persistence path.
 */
export function runEvidenceGateAdvisoryRefresh(
  ctx: CommandContext,
  options: RunEvidenceGateAdvisoryRefreshOptions,
): CommandResult {
  try {
    const checkpointId = (options.checkpointId ?? "").trim();
    if (checkpointId === "") {
      return failure("aiqt evidence gate advisory refresh requires --checkpoint <checkpoint-id>.", ExitCode.HumanInputRequired, "EVIDENCE-GATE-ADVISORY-REFRESH-NO-CHECKPOINT");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-REFRESH-INVALID-AS-OF");
    }
    // M29 §3.2: "otherwise it uses one command timestamp captured once at
    // command start" -- asOf and recordedAt both derive from this single
    // capture unless the caller supplies an explicit --as-of.
    const commandTimestamp = new Date().toISOString();
    const asOf = options.asOf ?? commandTimestamp;

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-REFRESH-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    const checkpoint = state.checkpoints.find((cp) => cp.id === checkpointId);
    if (!checkpoint) {
      return failure(`Checkpoint "${checkpointId}" does not exist.`, ExitCode.WorkflowBlocked, "EVIDENCE-GATE-ADVISORY-REFRESH-UNKNOWN-CHECKPOINT");
    }

    const result = runCheckpointAdvisory({
      state,
      project,
      checkpointId: checkpoint.id,
      workUnitId: checkpoint.workUnitId,
      trigger: "manual_refresh",
      asOf,
      recordedAt: commandTimestamp,
      issueKeys: [],
    });

    const summary = buildEvidenceAdvisorySummary(result.observation, checkpoint.id);

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: advisory refresh for checkpoint ${checkpoint.id} would record ${result.observation.evaluationStatus}${result.observation.overallResult ? ` (${result.observation.overallResult})` : ""}; no state written.`,
        exitCode: ExitCode.Success,
        data: { checkpointId: checkpoint.id, evidenceAdvisory: summary, outcome: "preview" },
      });
    }

    if (result.applyOutcome.kind === "conflict") {
      return failure(
        `Advisory observation identity conflict for checkpoint ${checkpoint.id}: an existing observation with the same identity has different content.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-ADVISORY-REFRESH-CONFLICT",
      );
    }

    if (result.applyOutcome.kind === "no_op") {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Advisory for checkpoint ${checkpoint.id} is already up to date (idempotent no-op).`,
        exitCode: ExitCode.Success,
        data: { checkpointId: checkpoint.id, evidenceAdvisory: summary, outcome: "no_op" },
      });
    }

    const finalState: StateModel = {
      ...state,
      checkpointEvidenceAdvisories: upsertCheckpointAdvisory(
        state.checkpointEvidenceAdvisories ?? [],
        result.applyOutcome.advisory,
      ),
    };
    writeStateModel(paths.stateFile, finalState);

    try {
      const eventIds = readRunlogEventIds(paths.runlogFile);
      const eventId = nextId("EVT", eventIds);
      appendRunlogEvent(
        paths.runlogFile,
        buildEvidenceGateAdvisoryObservationRecordedEvent({
          id: eventId,
          timestamp: commandTimestamp,
          relatedIds: [checkpoint.id, checkpoint.workUnitId],
          data: {
            observationId: result.observation.observationId,
            checkpointId: result.observation.checkpointId,
            workUnitId: result.observation.workUnitId,
            trigger: result.observation.trigger,
            evaluationStatus: result.observation.evaluationStatus,
            overallResult: result.observation.overallResult,
            ...(result.observation.policyRef ? { policyRef: result.observation.policyRef } : {}),
            asOf: result.observation.asOf,
            ...(result.observation.simulationDigest ? { simulationDigest: result.observation.simulationDigest } : {}),
            issueKeys: result.observation.issueKeys,
            recordedAt: result.observation.recordedAt,
          },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this refresh is idempotent.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-ADVISORY-REFRESH-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Advisory refreshed for checkpoint ${checkpoint.id}: ${result.observation.evaluationStatus}${result.observation.overallResult ? ` (${result.observation.overallResult})` : ""}.`,
      completedActions: ["Read project.json", "Read state.json", "Evaluated advisory", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [checkpoint.id, checkpoint.workUnitId],
      exitCode: ExitCode.Success,
      data: { checkpointId: checkpoint.id, evidenceAdvisory: summary, outcome: "refreshed" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-REFRESH-UNEXPECTED-ERROR");
  }
}
