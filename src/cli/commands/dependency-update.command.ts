import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildDependencyUpdatedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { applyWorkflowAssessmentToState } from "../../services/workflow-assessment-persistence.js";
import { recalculateMilestoneStatuses } from "../../workflow/checkpoint-status-transitions.js";
import {
  wouldIntroduceCycle,
  wouldInvalidateActiveExecution,
  recalculateReadinessAfterDependencyUpdate,
} from "../../workflow/dependency-update-transition.js";
import { DependencyTypeSchema, type DependencyType } from "../../schema/dependency.schema.js";
import type { StateModel, ProjectStatus } from "../../schema/state.schema.js";

export interface RunDependencyUpdateOptions {
  dependencyId?: string;
  type?: string;
  reason?: string;
}

const SOURCE_COMMAND = "aiqt dependency update";

function failInvalidInput(id: string, message: string): CommandResult {
  return makeResult({
    status: "failed",
    action: "dependency",
    summary: message,
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [
      {
        id,
        severity: "high",
        area: "input",
        message,
        agentCanFix: false,
      },
    ],
  });
}

/**
 * Recompute projectStatus after a dependency update, mirroring the
 * established recompute-after-graph-mutation convention (next-cancel,
 * issue-promote): review/all-done stay authoritative; otherwise fall back to
 * whatever already reflects active in-progress work.
 */
function recomputeProjectStatusAfterDependencyUpdate(
  workUnits: readonly { status: string }[],
  currentWorkUnitId: string | null,
  previousStatus: ProjectStatus,
): ProjectStatus {
  if (workUnits.some((wu) => wu.status === "needs_review")) return "review";
  if (workUnits.length > 0 && workUnits.every((wu) => wu.status === "done")) return "review";
  if (currentWorkUnitId !== null) return "in_progress";
  if (previousStatus === "review" || previousStatus === "done") return "planned";
  return previousStatus;
}

/**
 * aiqt dependency update <dependency-id> --type blocks|requires|relates_to
 * --reason "..." (M12 §8.2). Mutates the canonical dependency's type only
 * after validating no cycle would be introduced and no active in_progress
 * execution cycle would be invalidated. Never creates or deletes dependencies.
 */
export function runDependencyUpdate(
  ctx: CommandContext,
  options: RunDependencyUpdateOptions,
): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "dependency",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "DEPENDENCY-UPDATE-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const dependencyId = (options.dependencyId ?? "").trim();
    if (dependencyId === "") {
      return failInvalidInput(
        "DEPENDENCY-UPDATE-MISSING-ID",
        'A dependency id is required: aiqt dependency update <dependency-id> --type blocks|requires|relates_to --reason "..."',
      );
    }

    const typeParse = DependencyTypeSchema.safeParse(options.type);
    if (!typeParse.success) {
      return failInvalidInput(
        "DEPENDENCY-UPDATE-INVALID-TYPE",
        `--type is required and must be one of: ${DependencyTypeSchema.options.join(", ")}.`,
      );
    }
    const newType: DependencyType = typeParse.data;

    const reason = (options.reason ?? "").trim();
    if (reason === "") {
      return failInvalidInput(
        "DEPENDENCY-UPDATE-MISSING-REASON",
        "--reason is required and must be non-empty.",
      );
    }

    const { paths, project, state } = loadProject(ctx);

    const dependency = state.workGraph.dependencies.find((d) => d.id === dependencyId);
    if (!dependency) {
      const message = `Dependency "${dependencyId}" does not exist.`;
      return makeResult({
        status: "failed",
        action: "dependency",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "DEPENDENCY-UPDATE-UNKNOWN-DEPENDENCY",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (dependency.type === newType) {
      const assessedState = applyWorkflowAssessmentToState(project, state);
      const nextRecommendedCommand = assessedState.nextRecommendedCommand ?? "aiqt review";
      return makeResult({
        status: "passed",
        action: "dependency",
        projectStatus: assessedState.projectStatus,
        currentMilestoneId: assessedState.currentMilestoneId,
        currentWorkUnitId: assessedState.currentWorkUnitId,
        summary: `Dependency "${dependencyId}" already has type "${newType}".`,
        nextRecommendedCommand,
        exitCode: ExitCode.Success,
        data: {
          dependencyId,
          previousType: dependency.type,
          newType,
          affectedWorkUnits: [],
          changed: false,
        },
      });
    }

    if (
      wouldIntroduceCycle(
        state.workGraph.workUnits,
        state.workGraph.dependencies,
        dependencyId,
        newType,
      )
    ) {
      const message = `Updating dependency "${dependencyId}" to type "${newType}" would introduce a cycle in the blocking/requires dependency graph.`;
      return makeResult({
        status: "blocked",
        action: "dependency",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt graph validate",
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "DEPENDENCY-UPDATE-CYCLE",
            severity: "high",
            area: "workflow",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (wouldInvalidateActiveExecution(state.workGraph.workUnits, dependency, newType)) {
      const message = `Updating dependency "${dependencyId}" to type "${newType}" would invalidate the active in_progress execution cycle for work unit "${dependency.toId}".`;
      return makeResult({
        status: "blocked",
        action: "dependency",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt checkpoint",
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "DEPENDENCY-UPDATE-INVALIDATES-ACTIVE-EXECUTION",
            severity: "high",
            area: "workflow",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const timestamp = new Date().toISOString();
    const previousType = dependency.type;
    const updatedDependencies = state.workGraph.dependencies.map((d) =>
      d.id === dependencyId ? { ...d, type: newType } : d,
    );

    const recalculated = recalculateReadinessAfterDependencyUpdate(
      state.workGraph.workUnits,
      updatedDependencies,
      timestamp,
    );
    const milestones = recalculateMilestoneStatuses(
      recalculated.workUnits,
      state.workGraph.milestones,
    );
    const projectStatus = recomputeProjectStatusAfterDependencyUpdate(
      recalculated.workUnits,
      state.currentWorkUnitId,
      state.projectStatus,
    );

    const stateWithUpdate: StateModel = {
      ...state,
      projectStatus,
      workGraph: {
        ...state.workGraph,
        dependencies: updatedDependencies,
        workUnits: recalculated.workUnits,
        milestones,
      },
      lastUpdatedAt: timestamp,
    };

    const finalState: StateModel = applyWorkflowAssessmentToState(project, stateWithUpdate);
    const nextRecommendedCommand = finalState.nextRecommendedCommand ?? "aiqt review";
    writeStateModel(paths.stateFile, finalState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    const affectedWorkUnits = [
      ...recalculated.newlyReadyWorkUnitIds,
      ...recalculated.newlyPlannedWorkUnitIds,
    ];
    appendRunlogEvent(
      paths.runlogFile,
      buildDependencyUpdatedEvent({
        id: eventId,
        timestamp,
        relatedIds: [dependencyId, dependency.fromId, dependency.toId],
        data: {
          dependencyId,
          fromWorkUnitId: dependency.fromId,
          toWorkUnitId: dependency.toId,
          previousType,
          newType,
          reason,
          sourceCommand: SOURCE_COMMAND,
        },
      }),
    );

    return makeResult({
      status: "passed",
      action: "dependency",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Dependency ${dependencyId} updated from ${previousType} to ${newType}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Updated dependency type",
        "Recalculated readiness",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [dependencyId, dependency.fromId, dependency.toId],
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        dependencyId,
        previousType,
        newType,
        affectedWorkUnits,
        changed: true,
      },
    });
  } catch (err) {
    return errorToResult("dependency", err);
  }
}
