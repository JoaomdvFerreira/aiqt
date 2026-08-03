import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { AiqtError } from "../../core/output/aiqt-error.js";
import type { Issue } from "../../core/output/issue.js";
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
  PlanAppendInputSchema,
  type PlanExtensionInput,
  type PlanAppendInput,
} from "../../schema/plan-extension-input.schema.js";
import { buildWorkGraphFromPlanInput } from "../../services/planning-service.js";
import { buildPlanAppend, buildPlanRefinement } from "../../services/plan-extension-service.js";
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

function validatePlanRefinementInput(raw: unknown): PlanExtensionInput {
  const parsed = PlanExtensionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid refinement input: ${parsed.error.issues
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

function loadPlanRefinementInputFromFile(path: string): PlanExtensionInput {
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
  return validatePlanRefinementInput(raw);
}

function validatePlanAppendInput(raw: unknown): PlanAppendInput {
  const parsed = PlanAppendInputSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid append input: ${parsed.error.issues
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

function loadPlanAppendInputFromFile(path: string): PlanAppendInput {
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
  return validatePlanAppendInput(raw);
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
  /** M17/M17-RC1: extend an existing (non-empty) work graph instead of the one-shot initial plan. */
  extend?: boolean;
  /** M17-RC1: the work unit to refine. Selects the "refine" operation when present. */
  refineWorkUnit?: string;
  /** @deprecated M17-RC1: use `refineWorkUnit`. Kept as a functional alias for M17 backward compatibility. */
  replacePlaceholder?: string;
  /** Validate and report plan changes without persisting or appending runlog events. */
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

const DEPRECATED_ALIAS_WARNING: Issue = {
  id: "PLAN-EXTEND-DEPRECATED-ALIAS",
  severity: "low",
  area: "input",
  message: "--replace-placeholder is deprecated; use --refine-work-unit instead. It remains functional for backward compatibility.",
  agentCanFix: true,
};

/**
 * M17-RC1 §6/§7: `aiqt plan --extend --refine-work-unit <id>`. Replaces one
 * eligible existing work unit with a detailed replacement subgraph, wiring
 * its boundary dependencies onto the replacement and preserving it as
 * "replanned" audit history. Reuses the same file/stdin input plumbing,
 * atomic state writer, and runlog append conventions as ordinary planning.
 */
function runPlanRefine(
  paths: AiqtPaths,
  project: ProjectModel,
  state: StateModel,
  options: RunPlanOptions,
  targetWorkUnitId: string,
  warnings: Issue[],
): CommandResult {
  if (!options.fromFile && options.input === undefined) {
    return makeResult({
      status: "needs_input",
      action: "plan",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: "No refinement input file supplied. Provide a structured refinement via --from-file.",
      requiresHumanInput: true,
      nextRecommendedCommand: `aiqt plan --extend --refine-work-unit ${targetWorkUnitId} --from-file <path>`,
      exitCode: ExitCode.HumanInputRequired,
      warnings,
    });
  }

  let refinementInput: PlanExtensionInput;
  try {
    refinementInput = options.input !== undefined
      ? validatePlanRefinementInput(options.input)
      : loadPlanRefinementInputFromFile(options.fromFile!);
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
        warnings,
      });
    }
    throw err;
  }

  const timestamp = new Date().toISOString();
  let outcome;
  try {
    outcome = buildPlanRefinement({
      state,
      targetWorkUnitId,
      input: refinementInput,
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
        warnings,
      });
    }
    throw err;
  }

  const previewNextCommand = options.fromFile
    ? `aiqt plan --extend --refine-work-unit ${outcome.targetWorkUnitId} --from-file ${options.fromFile}`
    : `aiqt import plan --stdin --extend --refine-work-unit ${outcome.targetWorkUnitId}`;

  const sharedData = {
    operation: "refine" as const,
    targetWorkUnitId: outcome.targetWorkUnitId,
    targetFinalStatus: "replanned" as const,
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
    outcome.targetWorkUnitId,
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
      summary: `Preview: would refine work unit ${outcome.targetWorkUnitId} into a replacement subgraph. No files were changed.`,
      completedActions: [
        "Validated refinement input",
        "Validated target eligibility",
        "Validated candidate graph",
      ],
      changedFiles: [],
      affectedItems,
      nextRecommendedCommand: previewNextCommand,
      exitCode: ExitCode.Success,
      warnings,
      data: { ...sharedData, preview: true, mutationPerformed: false },
    });
  }

  writeStateModel(paths.stateFile, outcome.state);

  const eventIdsBefore = readRunlogEventIds(paths.runlogFile);
  const extendEventId = nextId("EVT", eventIdsBefore);
  const extendRelatedIds = [
    project.project.id,
    outcome.targetWorkUnitId,
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
        operation: "refine",
        addedMilestoneIds: outcome.addedMilestoneIds,
        addedWorkUnitIds: outcome.addedWorkUnitIds,
        addedDependencyIds: outcome.addedDependencyIds,
        nextRecommendedCommand: outcome.nextRecommendedCommand,
        targetWorkUnitId: outcome.targetWorkUnitId,
        reason: outcome.reason,
        entryWorkUnitIds: outcome.entryWorkUnitIds,
        exitWorkUnitIds: outcome.exitWorkUnitIds,
        copiedIncomingDependencyIds: outcome.copiedIncomingDependencyIds,
        copiedOutgoingDependencyIds: outcome.copiedOutgoingDependencyIds,
      },
    }),
  );

  const replannedEventId = nextId("EVT", [...eventIdsBefore, extendEventId]);
  appendRunlogEvent(
    paths.runlogFile,
    buildWorkUnitStatusChangedEvent({
      id: replannedEventId,
      timestamp,
      relatedIds: [project.project.id, outcome.targetWorkUnitId],
      data: {
        workUnitId: outcome.targetWorkUnitId,
        fromStatus: outcome.targetOriginalStatus,
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
    summary: `Refined work unit ${outcome.targetWorkUnitId} into a replacement subgraph.`,
    completedActions: [
      "Validated refinement input",
      "Validated target eligibility",
      "Validated candidate graph",
      "Added milestones, work units, and dependencies",
      `Marked ${outcome.targetWorkUnitId} replanned`,
    ],
    changedFiles: [paths.stateFile, paths.runlogFile],
    affectedItems,
    nextRecommendedCommand: outcome.nextRecommendedCommand,
    exitCode: ExitCode.Success,
    warnings,
    data: { ...sharedData, preview: false, mutationPerformed: true },
  });
}

/**
 * M17-RC1 §5.1/§7: `aiqt plan --extend --from-file <path>` with no
 * refinement target. Adds milestones/work units/dependencies to the
 * existing graph without touching any existing record's status or scope.
 */
function runPlanAppendOp(
  paths: AiqtPaths,
  project: ProjectModel,
  state: StateModel,
  options: RunPlanOptions,
  warnings: Issue[],
): CommandResult {
  if (!options.fromFile && options.input === undefined) {
    return makeResult({
      status: "needs_input",
      action: "plan",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: "No append input file supplied. Provide a structured append payload via --from-file.",
      requiresHumanInput: true,
      nextRecommendedCommand: "aiqt plan --extend --from-file <path>",
      exitCode: ExitCode.HumanInputRequired,
      warnings,
    });
  }

  let appendInput: PlanAppendInput;
  try {
    appendInput = options.input !== undefined
      ? validatePlanAppendInput(options.input)
      : loadPlanAppendInputFromFile(options.fromFile!);
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
        warnings,
      });
    }
    throw err;
  }

  const timestamp = new Date().toISOString();
  let outcome;
  try {
    outcome = buildPlanAppend({ state, input: appendInput, timestamp });
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
        warnings,
      });
    }
    throw err;
  }

  const previewNextCommand = options.fromFile
    ? `aiqt plan --extend --from-file ${options.fromFile}`
    : "aiqt import plan --stdin --extend";

  const sharedData = {
    operation: "append" as const,
    addedMilestoneIds: outcome.addedMilestoneIds,
    addedWorkUnitIds: outcome.addedWorkUnitIds,
    addedDependencyIds: outcome.addedDependencyIds,
    completedWorkUnitsModified: outcome.completedWorkUnitsModified,
    completedMilestonesModified: outcome.completedMilestonesModified,
    cyclesIntroduced: outcome.cyclesIntroduced,
  };

  const affectedItems = [
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
      summary: "Preview: would append to the work graph. No files were changed.",
      completedActions: ["Validated append input", "Validated candidate graph"],
      changedFiles: [],
      affectedItems,
      nextRecommendedCommand: previewNextCommand,
      exitCode: ExitCode.Success,
      warnings,
      data: { ...sharedData, preview: true, mutationPerformed: false },
    });
  }

  writeStateModel(paths.stateFile, outcome.state);

  const eventIdsBefore = readRunlogEventIds(paths.runlogFile);
  const extendEventId = nextId("EVT", eventIdsBefore);
  appendRunlogEvent(
    paths.runlogFile,
    buildPlanExtendedEvent({
      id: extendEventId,
      timestamp,
      relatedIds: [
        project.project.id,
        ...outcome.addedMilestoneIds,
        ...outcome.addedWorkUnitIds,
        ...outcome.addedDependencyIds,
      ],
      data: {
        operation: "append",
        addedMilestoneIds: outcome.addedMilestoneIds,
        addedWorkUnitIds: outcome.addedWorkUnitIds,
        addedDependencyIds: outcome.addedDependencyIds,
        nextRecommendedCommand: outcome.nextRecommendedCommand,
      },
    }),
  );

  return makeResult({
    status: "passed",
    action: "plan",
    projectStatus: outcome.state.projectStatus,
    currentMilestoneId: outcome.state.currentMilestoneId,
    currentWorkUnitId: outcome.state.currentWorkUnitId,
    summary: "Appended milestones, work units, and dependencies to the work graph.",
    completedActions: [
      "Validated append input",
      "Validated candidate graph",
      "Added milestones, work units, and dependencies",
    ],
    changedFiles: [paths.stateFile, paths.runlogFile],
    affectedItems,
    nextRecommendedCommand: outcome.nextRecommendedCommand,
    exitCode: ExitCode.Success,
    warnings,
    data: { ...sharedData, preview: false, mutationPerformed: true },
  });
}

export function runPlan(
  ctx: CommandContext,
  options: RunPlanOptions,
): CommandResult {
  try {
    // M17-RC1 §4: CLI-combination validation is independent of project state.
    if (options.refineWorkUnit && options.replacePlaceholder) {
      return invalidInput(
        "PLAN-EXTEND-TARGET-CONFLICT",
        "--refine-work-unit and --replace-placeholder cannot both be supplied.",
      );
    }
    const targetWorkUnitId = options.refineWorkUnit ?? options.replacePlaceholder;
    const usedDeprecatedAlias = !options.refineWorkUnit && Boolean(options.replacePlaceholder);

    if (targetWorkUnitId && !options.extend) {
      return invalidInput(
        "PLAN-EXTEND-TARGET-REQUIRES-EXTEND",
        "--refine-work-unit (or the deprecated --replace-placeholder alias) requires --extend.",
      );
    }

    const { paths, project, state } = loadProject(ctx);

    if (options.extend) {
      const warnings = usedDeprecatedAlias ? [DEPRECATED_ALIAS_WARNING] : [];

      if (state.workGraph.milestones.length === 0) {
        return blockedOnState(
          state,
          "No work graph exists yet. aiqt plan --extend requires an existing graph; run ordinary aiqt plan first.",
          "aiqt plan",
          "PLAN-EXTEND-GRAPH-EMPTY",
        );
      }

      return targetWorkUnitId
        ? runPlanRefine(paths, project, state, options, targetWorkUnitId, warnings)
        : runPlanAppendOp(paths, project, state, options, warnings);
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

    const affectedItems = [
      ...result.milestones.map((m) => m.id),
      ...result.workUnits.map((wu) => wu.id),
      ...result.dependencies.map((d) => d.id),
    ];

    const sharedData = {
      milestoneCount: result.milestones.length,
      workUnitCount: result.workUnits.length,
      dependencyCount: result.dependencies.length,
      readyWorkUnitId: result.readyWorkUnitId,
      readyWorkUnitCount: result.readyWorkUnitCount,
      plannedWorkUnitCount: result.plannedWorkUnitCount,
      workGraphWasEmpty: true,
    };

    const replayCommand = options.fromFile
      ? `aiqt plan --from-file ${options.fromFile}`
      : "aiqt import plan --stdin";

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "plan",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: "Preview: would generate the initial work graph. No files were changed.",
        completedActions: [
          "Read project.json",
          "Read state.json",
          "Validated plan input",
          "Computed candidate work graph",
        ],
        changedFiles: [],
        affectedItems,
        nextRecommendedCommand: replayCommand,
        exitCode: ExitCode.Success,
        data: { ...sharedData, preview: true, mutationPerformed: false },
      });
    }

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
      affectedItems,
      nextRecommendedCommand: "aiqt next",
      exitCode: ExitCode.Success,
      data: { ...sharedData, preview: false, mutationPerformed: true },
    });
  } catch (err) {
    return errorToResult("plan", err);
  }
}
