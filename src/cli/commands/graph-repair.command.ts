import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  readAgentPacketIds,
  appendRunlogEvent,
  buildGraphRepairedEvent,
  buildWorkUnitStatusChangedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { validateGraph } from "../../services/graph-validation-service.js";
import {
  buildGraphRepairPlan,
  applyPointerRepairs,
  applyStaleReadinessRepair,
} from "../../services/graph-repair-service.js";
import type { StateModel } from "../../schema/state.schema.js";
import { applyWorkflowAssessmentToState } from "../../services/workflow-assessment-persistence.js";

export interface RunGraphRepairOptions {
  dryRun?: boolean;
  /** M18 §11.2: atomically apply deterministic stale-readiness repairs. */
  apply?: boolean;
}

function checkpointPacketDiagnosticFingerprint(validation: ReturnType<typeof validateGraph>): string[] {
  return validation.blockingErrors
    .filter((error) => error.rule === "broken-checkpoint-packet-reference")
    .map((error) => [error.rule, error.workUnitId ?? "", error.dependencyId ?? "", error.message].join("\u0000"))
    .sort();
}

function canApplyDeterministicRepair(validation: ReturnType<typeof validateGraph>): boolean {
  const errors = validation.blockingErrors;
  const packetDiagnostics = checkpointPacketDiagnosticFingerprint(validation);
  if (packetDiagnostics.length > 0) {
    return errors.every((error) => error.rule === "broken-checkpoint-packet-reference");
  }
  return errors.every((error) => error.rule === "broken-current-work-unit-reference");
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
    const plan = buildGraphRepairPlan(validation, state);

    if (options.apply && !canApplyDeterministicRepair(validation)) {
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

    if (options.dryRun) {
      // M18 §14: dry-run always succeeds (with or without proposed changes)
      // -- it is read-only, so an empty plan is not a workflow-blocked
      // condition the way "nothing to repair" once was pre-M18.
      const totalProposals = plan.suggestions.length + plan.staleReadinessRepairs.length + plan.pointerRepairs.length;
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
    if (plan.staleReadinessRepairs.length === 0 && plan.pointerRepairs.length === 0) {
      return makeResult({
        status: "passed",
        action: "graph",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: "No deterministic stale-readiness repairs to apply. Graph is already normalized.",
        nextRecommendedCommand: "aiqt graph validate",
        exitCode: ExitCode.Success,
        data: { wouldMutate: false, mutationPerformed: false, repairedWorkUnitIds: [], repairedPointers: [], changes: [] },
      });
    }

    const toleratedPacketDiagnostics = checkpointPacketDiagnosticFingerprint(validation);
    const timestamp = new Date().toISOString();
    const pointerRepair = applyPointerRepairs(state, timestamp);
    const repair = applyStaleReadinessRepair(pointerRepair.state, timestamp);

    // M18 §12: candidate-state validation before persistence -- only status
    // fields changed, but this reuses the same shared validator rather than
    // trusting the repair builder's output blindly.
    const candidateValidation = validateGraph(project, repair.state, knownPacketIds);
    const candidatePacketDiagnostics = checkpointPacketDiagnosticFingerprint(candidateValidation);
    const toleratedDiagnosticsChanged = JSON.stringify(candidatePacketDiagnostics) !== JSON.stringify(toleratedPacketDiagnostics);
    if (!canApplyDeterministicRepair(candidateValidation) || toleratedDiagnosticsChanged) {
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

    const finalState: StateModel = applyWorkflowAssessmentToState(project, repair.state);
    writeStateModel(paths.stateFile, finalState);

    let eventIds = readRunlogEventIds(paths.runlogFile);
    for (const change of repair.changes) {
      const eventId = nextId("EVT", eventIds);
      eventIds = [...eventIds, eventId];
      const workUnit = repair.state.workGraph.workUnits.find((wu) => wu.id === change.workUnitId)!;
      appendRunlogEvent(
        paths.runlogFile,
        buildWorkUnitStatusChangedEvent({
          id: eventId,
          timestamp,
          relatedIds: [change.workUnitId, workUnit.milestoneId],
          data: {
            workUnitId: change.workUnitId,
            fromStatus: change.from,
            toStatus: change.to,
            reason: "Deterministic graph readiness reconciliation.",
          },
        }),
      );
    }
    const eventId = nextId("EVT", eventIds);
    appendRunlogEvent(
      paths.runlogFile,
      buildGraphRepairedEvent({
        id: eventId,
        timestamp,
        relatedIds: [
          ...repair.repairedWorkUnitIds,
          ...pointerRepair.repairedPointers.map((pointer) => pointer.from),
        ],
        data: {
          repairType: pointerRepair.repairedPointers.length > 0 ? "workflow_integrity" : "stale_readiness",
          workUnitIds: repair.repairedWorkUnitIds,
          repairedPointers: pointerRepair.repairedPointers,
          changes: repair.changes,
        },
      }),
    );

    const repairedPointerNames = pointerRepair.repairedPointers.map((pointer) => pointer.pointerName);
    const summary =
      repair.repairedWorkUnitIds.length > 0 && repairedPointerNames.length > 0
        ? `Reconciled ${repair.repairedWorkUnitIds.length} work unit readiness state(s) and cleared ${repairedPointerNames.length} dangling pointer(s).`
        : repair.repairedWorkUnitIds.length > 0
          ? `Reconciled ${repair.repairedWorkUnitIds.length} work unit readiness state(s): ${repair.repairedWorkUnitIds.join(", ")}.`
          : `Cleared ${repairedPointerNames.length} dangling workflow pointer(s): ${repairedPointerNames.join(", ")}.`;

    return makeResult({
      status: "passed",
      action: "graph",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Computed effective readiness",
        "Applied deterministic readiness reconciliation",
        "Validated candidate state",
        "Wrote state.json",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [
        ...repair.repairedWorkUnitIds,
        ...pointerRepair.repairedPointers.map((pointer) => pointer.from),
      ],
      nextRecommendedCommand: finalState.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        wouldMutate: true,
        mutationPerformed: true,
        repairedWorkUnitIds: repair.repairedWorkUnitIds,
        repairedPointers: pointerRepair.repairedPointers,
        changes: repair.changes,
      },
    });
  } catch (err) {
    return errorToResult("graph", err);
  }
}
