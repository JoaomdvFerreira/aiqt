import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { runCheckpointAdvisory } from "../../workflow/checkpoint-advisory-integration.js";
import { persistCheckpointAdvisoryResult } from "../../workflow/checkpoint-advisory-persistence.js";
import { buildEvidenceAdvisorySummary } from "../../workflow/checkpoint-advisory-visibility.js";

export interface RunEvidenceGateAdvisoryRefreshOptions {
  checkpointId?: string;
  asOf?: string;
  preview?: boolean;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * aiqt evidence gate advisory refresh --checkpoint <id> [--as-of <ts>]
 * [--preview] [--json] (M29 §3.4): the sole explicit, on-demand advisory
 * re-evaluation boundary. Never changes checkpoint completion. Reuses the
 * same runCheckpointAdvisory pipeline and persistCheckpointAdvisoryResult
 * persistence path as automatic checkpoint evaluation -- no second
 * evaluator, no second persistence path.
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
    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === checkpoint.workUnitId);
    if (!workUnit) {
      return failure(`Checkpoint "${checkpointId}" references work unit "${checkpoint.workUnitId}", which does not exist.`, ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-REFRESH-INVALID-STATE");
    }

    const result = runCheckpointAdvisory({
      state,
      project,
      checkpointId: checkpoint.id,
      workUnitId: checkpoint.workUnitId,
      milestoneId: workUnit.milestoneId,
      trigger: "manual_refresh",
      asOf,
      recordedAt: commandTimestamp,
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

    let outcome;
    try {
      outcome = persistCheckpointAdvisoryResult({
        stateFile: paths.stateFile,
        runlogFile: paths.runlogFile,
        state,
        result,
        timestamp: commandTimestamp,
        checkpointId: checkpoint.id,
        workUnitId: checkpoint.workUnitId,
      });
    } catch (err) {
      return failure((err as Error).message, ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-REFRESH-CONFLICT");
    }

    if (outcome.runlogGap) {
      // M29 §7.2: "command returns exit 3 where the advisory operation is
      // explicit" -- unlike the automatic checkpoint-triggered path, this
      // command's entire purpose IS the advisory operation, so a runlog
      // gap after a successful state write (or an unrepaired gap on a
      // no_op replay) is surfaced directly. State remains authoritative;
      // retrying is idempotent.
      return failure(
        `State was written successfully but the runlog append failed. State remains authoritative; retrying this refresh is idempotent.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-ADVISORY-REFRESH-RUNLOG-APPEND-FAILED",
      );
    }

    const summaryText =
      outcome.kind === "no_op"
        ? `Advisory for checkpoint ${checkpoint.id} is already up to date (idempotent no-op).`
        : outcome.kind === "repaired"
          ? `Advisory for checkpoint ${checkpoint.id} was already current; backfilled a missing runlog event.`
          : `Advisory refreshed for checkpoint ${checkpoint.id}: ${result.observation.evaluationStatus}${result.observation.overallResult ? ` (${result.observation.overallResult})` : ""}.`;

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: summaryText,
      completedActions: ["Read project.json", "Read state.json", "Evaluated advisory", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [checkpoint.id, checkpoint.workUnitId],
      exitCode: ExitCode.Success,
      data: { checkpointId: checkpoint.id, evidenceAdvisory: summary, outcome: outcome.kind === "created" ? "refreshed" : outcome.kind },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EVIDENCE-GATE-ADVISORY-REFRESH-UNEXPECTED-ERROR");
  }
}
