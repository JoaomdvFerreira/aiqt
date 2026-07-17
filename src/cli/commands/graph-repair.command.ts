import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  readAgentPacketIds,
  appendRunlogEvent,
  buildGraphRepairedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { validateGraph } from "../../services/graph-validation-service.js";
import {
  buildGraphRepairPlan,
  applyStaleReadinessRepair,
} from "../../services/graph-repair-service.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunGraphRepairOptions {
  dryRun?: boolean;
  /** M18 §11.2: atomically apply deterministic stale-readiness repairs. */
  apply?: boolean;
}

/**
 * aiqt graph repair --dry-run | --apply (M12 §8.4, M18 §11): --dry-run is
 * read-only candidate repair planning built from aiqt graph validate
 * findings, plus (M18) deterministic stale-readiness `ready -> planned`
 * proposals. --apply atomically persists every deterministic
 * stale-readiness proposal in one write; every other repair family remains
 * investigation-only (no apply path). Exactly one of --dry-run/--apply is
 * required.
 */
export function runGraphRepair(
  ctx: CommandContext,
  options: RunGraphRepairOptions,
): CommandResult {
  try {
    if (options.dryRun && options.apply) {
      const message = "aiqt graph repair accepts either --dry-run or --apply, not both.";
      return makeResult({
        status: "failed",
        action: "graph",
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-CONFLICTING-MODE",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (!options.dryRun && !options.apply) {
      // M18 §11: preserves the exact pre-M18 error id for this exact input
      // shape (neither flag supplied) -- --apply is new, so this case is
      // unchanged compatibility territory, not "the corrected case."
      const message = "aiqt graph repair requires --dry-run or --apply.";
      return makeResult({
        status: "failed",
        action: "graph",
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-MISSING-DRY-RUN",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "graph",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const { paths, project, state } = loadProject(ctx);
    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const validation = validateGraph(project, state, knownPacketIds);

    if (options.apply && validation.blockingErrors.length > 0) {
      const message =
        "aiqt graph repair --apply cannot safely execute: the graph has blocking structural errors. Run aiqt graph validate first.";
      return makeResult({
        status: "failed",
        action: "graph",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt graph validate",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-APPLY-INVALID-GRAPH",
            severity: "critical",
            area: "graph",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const plan = buildGraphRepairPlan(validation, state);

    if (options.dryRun) {
      // M18 §14: dry-run always succeeds (with or without proposed changes)
      // -- it is read-only, so an empty plan is not a workflow-blocked
      // condition the way "nothing to repair" once was pre-M18.
      const totalProposals = plan.suggestions.length + plan.staleReadinessRepairs.length;
      return makeResult({
        status: totalProposals > 0 ? "warning" : "passed",
        action: "graph",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary:
          totalProposals > 0
            ? `Graph repair dry-run generated ${totalProposals} candidate repair(s).`
            : "Graph repair dry-run found no deterministic repairs to propose.",
        nextRecommendedCommand: "aiqt graph validate",
        exitCode: ExitCode.Success,
        data: plan,
      });
    }

    // --apply.
    if (plan.staleReadinessRepairs.length === 0) {
      return makeResult({
        status: "passed",
        action: "graph",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: "No deterministic stale-readiness repairs to apply. Graph is already normalized.",
        nextRecommendedCommand: "aiqt graph validate",
        exitCode: ExitCode.Success,
        data: { wouldMutate: false, mutationPerformed: false, repairedWorkUnitIds: [], changes: [] },
      });
    }

    const timestamp = new Date().toISOString();
    const repair = applyStaleReadinessRepair(state, timestamp);

    // M18 §12: candidate-state validation before persistence -- only status
    // fields changed, but this reuses the same shared validator rather than
    // trusting the repair builder's output blindly.
    const candidateValidation = validateGraph(project, repair.state, knownPacketIds);
    if (candidateValidation.blockingErrors.length > 0) {
      const message = "aiqt graph repair --apply produced an invalid candidate state. No changes were made.";
      return makeResult({
        status: "failed",
        action: "graph",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-APPLY-CANDIDATE-INVALID",
            severity: "critical",
            area: "graph",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const finalState: StateModel = { ...repair.state, nextRecommendedCommand: "aiqt graph validate" };
    writeStateModel(paths.stateFile, finalState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    appendRunlogEvent(
      paths.runlogFile,
      buildGraphRepairedEvent({
        id: eventId,
        timestamp,
        relatedIds: repair.repairedWorkUnitIds,
        data: {
          repairType: "stale_readiness",
          workUnitIds: repair.repairedWorkUnitIds,
          changes: repair.changes,
        },
      }),
    );

    return makeResult({
      status: "passed",
      action: "graph",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Repaired ${repair.repairedWorkUnitIds.length} stale-ready work unit(s): ${repair.repairedWorkUnitIds.join(", ")}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Computed effective readiness",
        "Applied deterministic stale-readiness repairs",
        "Validated candidate state",
        "Wrote state.json",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: repair.repairedWorkUnitIds,
      nextRecommendedCommand: "aiqt graph validate",
      exitCode: ExitCode.Success,
      data: {
        wouldMutate: true,
        mutationPerformed: true,
        repairedWorkUnitIds: repair.repairedWorkUnitIds,
        changes: repair.changes,
      },
    });
  } catch (err) {
    return errorToResult("graph", err);
  }
}
