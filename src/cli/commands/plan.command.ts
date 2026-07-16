import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { AiqtError } from "../../core/output/aiqt-error.js";
import { loadProject } from "./load-project.js";
import {
  readJsonFile,
  FileReadError,
  JsonParseError,
} from "../../core/filesystem/file-store.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildWorkGraphGeneratedEvent,
  buildPlanExtendedEvent,
  buildWorkUnitStatusChangedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { PlanInputSchema, type PlanInput } from "../../schema/plan-input.schema.js";
import {
  PlanExtensionInputSchema,
  type PlanExtensionInput,
} from "../../schema/plan-extension-input.schema.js";
import { buildWorkGraphFromPlanInput } from "../../services/planning-service.js";
import { buildPlanExtension } from "../../services/plan-extension-service.js";
import { isPlanningContextReady } from "../../workflow/planning-readiness.js";
import type { ProjectModel } from "../../schema/project.schema.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { AiqtPaths } from "../../core/filesystem/paths.js";

function validatePlanInput(raw: unknown): PlanInput {
  const parsed = PlanInputSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid plan input: ${parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ")}`;
    throw new AiqtError(message, ExitCode.InvalidInput, {
      id: "PLAN-INPUT-SCHEMA-INVALID",
      severity: "critical",
      area: "input",
      message,
      agentCanFix: false,
    });
  }
  return parsed.data;
}

function loadPlanInputFromFile(path: string): PlanInput {
  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      throw new AiqtError(err.message, ExitCode.InvalidInput, {
        id: "PLAN-FROM-FILE-INVALID",
        severity: "critical",
        area: "input",
        message: err.message,
        agentCanFix: false,
      });
    }
    throw err;
  }
  return validatePlanInput(raw);
}

function validatePlanExtensionInput(raw: unknown): PlanExtensionInput {
  const parsed = PlanExtensionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid plan extension input: ${parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ")}`;
    throw new AiqtError(message, ExitCode.InvalidInput, {
      id: "PLAN-EXTEND-INPUT-SCHEMA-INVALID",
      severity: "critical",
      area: "input",
      message,
      agentCanFix: false,
    });
  }
  return parsed.data;
}

function loadPlanExtensionInputFromFile(path: string): PlanExtensionInput {
  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      throw new AiqtError(err.message, ExitCode.InvalidInput, {
        id: "PLAN-EXTEND-FROM-FILE-INVALID",
        severity: "critical",
        area: "input",
        message: err.message,
        agentCanFix: false,
      });
    }
    throw err;
  }
  return validatePlanExtensionInput(raw);
}

function blockedOnState(
  state: StateModel,
  summary: string,
  nextRecommendedCommand: string | null,
  issueId: string,
): CommandResult {
  return makeResult({
    status: "blocked",
    action: "plan",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary,
    nextRecommendedCommand,
    exitCode: ExitCode.WorkflowBlocked,
    blockingIssues: [
      {
        id: issueId,
        severity: "high",
        area: "workflow",
        message: summary,
        agentCanFix: false,
      },
    ],
  });
}

export interface RunPlanOptions {
  fromFile?: string;
  /** Pre-parsed plan JSON (e.g. from aiqt import plan --stdin). Takes precedence over fromFile when set. */
  input?: unknown;
  /** M17: extend an existing (non-empty) work graph instead of the one-shot initial plan. */
  extend?: boolean;
  /** M17: the roadmap-placeholder work unit id targeted by --extend. */
  replacePlaceholder?: string;
  /** M17: validate and report the extension without persisting or appending runlog events. */
  preview?: boolean;
}

function invalidInput(id: string, message: string): CommandResult {
  return makeResult({
    status: "failed",
    action: "plan",
    summary: message,
    nextRecommendedCommand: null,
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [{ id, severity: "critical", area: "input", message, agentCanFix: false }],
  });
}

/**
 * M17: `aiqt plan --extend --replace-placeholder <id>`. A distinct flow from
 * ordinary one-shot planning -- it requires (rather than rejects) a
 * non-empty graph, and mutates through the candidate-state extension engine
 * instead of `buildWorkGraphFromPlanInput`. Reuses the same file/stdin input
 * plumbing, atomic state writer, and runlog append conventions as the
 * ordinary path.
 */
function runPlanExtend(
  paths: AiqtPaths,
  project: ProjectModel,
  state: StateModel,
  options: RunPlanOptions,
): CommandResult {
  if (!options.fromFile && options.input === undefined) {
    return makeResult({
      status: "needs_input",
      action: "plan",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: "No extension input file supplied. Provide a structured extension via --from-file.",
      requiresHumanInput: true,
      nextRecommendedCommand: `aiqt plan --extend --replace-placeholder ${options.replacePlaceholder} --from-file <path>`,
      exitCode: ExitCode.HumanInputRequired,
    });
  }

  if (state.workGraph.milestones.length === 0) {
    return blockedOnState(
      state,
      "No work graph exists yet. aiqt plan --extend requires an existing graph; run ordinary aiqt plan first.",
      "aiqt plan",
      "PLAN-EXTEND-GRAPH-EMPTY",
    );
  }

  let extensionInput: PlanExtensionInput;
  try {
    extensionInput = options.input !== undefined
      ? validatePlanExtensionInput(options.input)
      : loadPlanExtensionInputFromFile(options.fromFile!);
  } catch (err) {
    if (err instanceof AiqtError) {
      return makeResult({
        status: "failed",
        action: "plan",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: err.message,
        nextRecommendedCommand: state.nextRecommendedCommand,
        exitCode: err.exitCode,
        blockingIssues: err.issue ? [err.issue] : [],
      });
    }
    throw err;
  }

  const timestamp = new Date().toISOString();
  let outcome;
  try {
    outcome = buildPlanExtension({
      state,
      placeholderWorkUnitId: options.replacePlaceholder!,
      input: extensionInput,
      timestamp,
    });
  } catch (err) {
    if (err instanceof AiqtError) {
      return makeResult({
        status: err.exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed",
        action: "plan",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: err.message,
        nextRecommendedCommand: state.nextRecommendedCommand,
        exitCode: err.exitCode,
        blockingIssues: err.issue ? [err.issue] : [],
      });
    }
    throw err;
  }

  const previewNextCommand = options.fromFile
    ? `aiqt plan --extend --replace-placeholder ${outcome.placeholderWorkUnitId} --from-file ${options.fromFile}`
    : `aiqt import plan --stdin --extend --replace-placeholder ${outcome.placeholderWorkUnitId}`;

  const sharedData = {
    operation: "extend" as const,
    placeholderWorkUnitId: outcome.placeholderWorkUnitId,
    placeholderFinalStatus: "replanned" as const,
    reason: outcome.reason,
    addedMilestoneIds: outcome.addedMilestoneIds,
    addedWorkUnitIds: outcome.addedWorkUnitIds,
    addedDependencyIds: outcome.addedDependencyIds,
    entryWorkUnitIds: outcome.entryWorkUnitIds,
    exitWorkUnitIds: outcome.exitWorkUnitIds,
    copiedIncomingDependencyIds: outcome.copiedIncomingDependencyIds,
    copiedOutgoingDependencyIds: outcome.copiedOutgoingDependencyIds,
    completedWorkUnitsModified: outcome.completedWorkUnitsModified,
    completedMilestonesModified: outcome.completedMilestonesModified,
    cyclesIntroduced: outcome.cyclesIntroduced,
  };

  const affectedItems = [
    outcome.placeholderWorkUnitId,
    ...outcome.addedMilestoneIds,
    ...outcome.addedWorkUnitIds,
    ...outcome.addedDependencyIds,
  ];

  if (options.preview) {
    return makeResult({
      status: "passed",
      action: "plan",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Preview: would extend the work graph and replan placeholder ${outcome.placeholderWorkUnitId}. No files were changed.`,
      completedActions: [
        "Validated extension input",
        "Validated placeholder eligibility",
        "Validated candidate graph",
      ],
      changedFiles: [],
      affectedItems,
      nextRecommendedCommand: previewNextCommand,
      exitCode: ExitCode.Success,
      data: { ...sharedData, preview: true, mutationPerformed: false },
    });
  }

  writeStateModel(paths.stateFile, outcome.state);

  const eventIdsBefore = readRunlogEventIds(paths.runlogFile);
  const extendEventId = nextId("EVT", eventIdsBefore);
  const extendRelatedIds = [
    project.project.id,
    outcome.placeholderWorkUnitId,
    ...outcome.addedMilestoneIds,
    ...outcome.addedWorkUnitIds,
    ...outcome.addedDependencyIds,
  ];
  appendRunlogEvent(
    paths.runlogFile,
    buildPlanExtendedEvent({
      id: extendEventId,
      timestamp,
      relatedIds: extendRelatedIds,
      data: {
        placeholderWorkUnitId: outcome.placeholderWorkUnitId,
        reason: outcome.reason,
        addedMilestoneIds: outcome.addedMilestoneIds,
        addedWorkUnitIds: outcome.addedWorkUnitIds,
        addedDependencyIds: outcome.addedDependencyIds,
        entryWorkUnitIds: outcome.entryWorkUnitIds,
        exitWorkUnitIds: outcome.exitWorkUnitIds,
        copiedIncomingDependencyIds: outcome.copiedIncomingDependencyIds,
        copiedOutgoingDependencyIds: outcome.copiedOutgoingDependencyIds,
        nextRecommendedCommand: outcome.nextRecommendedCommand,
      },
    }),
  );

  const replannedEventId = nextId("EVT", [...eventIdsBefore, extendEventId]);
  appendRunlogEvent(
    paths.runlogFile,
    buildWorkUnitStatusChangedEvent({
      id: replannedEventId,
      timestamp,
      relatedIds: [project.project.id, outcome.placeholderWorkUnitId],
      data: {
        workUnitId: outcome.placeholderWorkUnitId,
        fromStatus: outcome.placeholderOriginalStatus,
        toStatus: "replanned",
        reason: outcome.reason,
      },
    }),
  );

  return makeResult({
    status: "passed",
    action: "plan",
    projectStatus: outcome.state.projectStatus,
    currentMilestoneId: outcome.state.currentMilestoneId,
    currentWorkUnitId: outcome.state.currentWorkUnitId,
    summary: `Extended the work graph and replanned placeholder ${outcome.placeholderWorkUnitId}.`,
    completedActions: [
      "Validated extension input",
      "Validated placeholder eligibility",
      "Validated candidate graph",
      "Added milestones, work units, and dependencies",
      `Marked ${outcome.placeholderWorkUnitId} replanned`,
    ],
    changedFiles: [paths.stateFile, paths.runlogFile],
    affectedItems,
    nextRecommendedCommand: outcome.nextRecommendedCommand,
    exitCode: ExitCode.Success,
    data: { ...sharedData, preview: false, mutationPerformed: true },
  });
}

export function runPlan(
  ctx: CommandContext,
  options: RunPlanOptions,
): CommandResult {
  try {
    // M17: CLI-combination validation is independent of project state.
    if (options.replacePlaceholder && !options.extend) {
      return invalidInput(
        "PLAN-EXTEND-PLACEHOLDER-REQUIRED",
        "--replace-placeholder requires --extend.",
      );
    }
    if (options.extend && !options.replacePlaceholder) {
      return invalidInput(
        "PLAN-EXTEND-PLACEHOLDER-REQUIRED",
        "--extend requires --replace-placeholder <id>.",
      );
    }

    const { paths, project, state } = loadProject(ctx);

    if (options.extend) {
      return runPlanExtend(paths, project, state, options);
    }

    // Gate: no-input must be evaluated before planningContextReady.
    if (!options.fromFile && options.input === undefined) {
      return makeResult({
        status: "needs_input",
        action: "plan",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary:
          "No plan input file supplied. Provide a structured plan via --from-file.",
        requiresHumanInput: true,
        nextRecommendedCommand: "aiqt plan --from-file <path>",
        exitCode: ExitCode.HumanInputRequired,
      });
    }

    if (!isPlanningContextReady(project)) {
      return blockedOnState(
        state,
        "Project context is not ready for planning. Run aiqt update to capture more context.",
        "aiqt update",
        "PLAN-CONTEXT-NOT-READY",
      );
    }

    if (state.workGraph.milestones.length > 0) {
      return blockedOnState(
        state,
        "A work graph already exists. aiqt plan does not replan an existing graph.",
        state.nextRecommendedCommand,
        "PLAN-GRAPH-NOT-EMPTY",
      );
    }

    let built;
    try {
      const planInput = options.input !== undefined
        ? validatePlanInput(options.input)
        : loadPlanInputFromFile(options.fromFile!);
      const timestamp = new Date().toISOString();
      built = { planInput, timestamp, result: buildWorkGraphFromPlanInput(planInput, timestamp) };
    } catch (err) {
      if (err instanceof AiqtError) {
        return makeResult({
          status: "failed",
          action: "plan",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: err.message,
          nextRecommendedCommand: state.nextRecommendedCommand,
          exitCode: err.exitCode,
          blockingIssues: err.issue ? [err.issue] : [],
        });
      }
      throw err;
    }

    const { timestamp, result } = built;

    const newState: StateModel = {
      ...state,
      projectStatus: "planned",
      currentMilestoneId: result.currentMilestoneId,
      currentWorkUnitId: null,
      workGraph: {
        milestones: result.milestones,
        workUnits: result.workUnits,
        dependencies: result.dependencies,
      },
      nextRecommendedCommand: "aiqt next",
      lastUpdatedAt: timestamp,
    };

    writeStateModel(paths.stateFile, newState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    const relatedIds = [
      project.project.id,
      ...result.milestones.map((m) => m.id),
      ...result.workUnits.map((wu) => wu.id),
      ...result.dependencies.map((d) => d.id),
    ];
    appendRunlogEvent(
      paths.runlogFile,
      buildWorkGraphGeneratedEvent({
        id: eventId,
        timestamp,
        relatedIds,
        data: {
          source: "from-file",
          milestoneCount: result.milestones.length,
          workUnitCount: result.workUnits.length,
          dependencyCount: result.dependencies.length,
          readyWorkUnitId: result.readyWorkUnitId,
          nextRecommendedCommand: "aiqt next",
        },
      }),
    );

    return makeResult({
      status: "passed",
      action: "plan",
      projectStatus: "planned",
      currentMilestoneId: result.currentMilestoneId,
      currentWorkUnitId: null,
      summary: "Work graph generated.",
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Generated work graph",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [
        ...result.milestones.map((m) => m.id),
        ...result.workUnits.map((wu) => wu.id),
        ...result.dependencies.map((d) => d.id),
      ],
      nextRecommendedCommand: "aiqt next",
      exitCode: ExitCode.Success,
      data: {
        milestoneCount: result.milestones.length,
        workUnitCount: result.workUnits.length,
        dependencyCount: result.dependencies.length,
        readyWorkUnitId: result.readyWorkUnitId,
        readyWorkUnitCount: result.readyWorkUnitCount,
        plannedWorkUnitCount: result.plannedWorkUnitCount,
        workGraphWasEmpty: true,
      },
    });
  } catch (err) {
    return errorToResult("plan", err);
  }
}
