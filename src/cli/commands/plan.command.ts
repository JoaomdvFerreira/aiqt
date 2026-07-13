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
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { PlanInputSchema, type PlanInput } from "../../schema/plan-input.schema.js";
import { buildWorkGraphFromPlanInput } from "../../services/planning-service.js";
import { isPlanningContextReady } from "../../workflow/planning-readiness.js";
import type { StateModel } from "../../schema/state.schema.js";

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
}

export function runPlan(
  ctx: CommandContext,
  options: RunPlanOptions,
): CommandResult {
  try {
    const { paths, project, state } = loadProject(ctx);

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
