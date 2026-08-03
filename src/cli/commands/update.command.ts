import type { CommandContext } from "../command-context.js";
import type { RawUpdateOptions } from "../options.js";
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
import { writeProjectModel } from "../../state/project-store.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  buildProjectUpdatedEvent,
  buildDecisionRecordedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { persistCoordinatedMutation } from "../../state/coordinated-persistence.js";
import { nextId } from "../../state/ids.js";
import { UpdateInputSchema, type UpdateInput } from "../../schema/update-input.schema.js";
import {
  applyUpdatePatch,
  mergeFileAndFlagPatches,
} from "../../services/project-update-service.js";
import { collectInteractiveInput } from "../prompts/update-prompts.js";

function validateUpdateInput(raw: unknown): UpdateInput {
  const parsed = UpdateInputSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid update input: ${parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ")}`;
    throw new AiqtError(message, ExitCode.InvalidInput, {
      id: "UPDATE-INPUT-SCHEMA-INVALID",
      severity: "critical",
      area: "input",
      message,
      agentCanFix: false,
    });
  }
  return parsed.data;
}

function loadUpdatePatchFromFile(path: string): UpdateInput {
  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      throw new AiqtError(err.message, ExitCode.InvalidInput, {
        id: "UPDATE-FROM-FILE-INVALID",
        severity: "critical",
        area: "input",
        message: err.message,
        agentCanFix: false,
      });
    }
    throw err;
  }
  return validateUpdateInput(raw);
}

function isTty(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

/**
 * M16 §7.1/§10: --implementation-root is a clearer alias for --repository-path;
 * both write existingRepositoryPath. Supplying both with different values is
 * invalid input (exit 3). Equal values (including via idempotent re-runs)
 * are not a conflict.
 */
function resolveEffectiveRepositoryPath(raw: RawUpdateOptions): string | undefined {
  const implementationRoot = raw.implementationRoot?.trim();
  const repositoryPath = raw.repositoryPath?.trim();
  if (implementationRoot && repositoryPath && implementationRoot !== repositoryPath) {
    const message =
      "--implementation-root and --repository-path were both supplied with different values.";
    throw new AiqtError(message, ExitCode.InvalidInput, {
      id: "UPDATE-ROOT-ALIAS-CONFLICT",
      severity: "critical",
      area: "input",
      message,
      agentCanFix: false,
    });
  }
  return implementationRoot || repositoryPath || undefined;
}

export async function runUpdate(
  ctx: CommandContext,
  raw: RawUpdateOptions,
): Promise<CommandResult> {
  try {
    const { paths, project, state } = loadProject(ctx);

    const effectiveRepositoryPath = resolveEffectiveRepositoryPath(raw);

    const hasDirectInput =
      Boolean(raw.fromFile) ||
      raw.input !== undefined ||
      Boolean(raw.objective) ||
      (raw.targetUser?.length ?? 0) > 0 ||
      Boolean(raw.agent) ||
      Boolean(effectiveRepositoryPath);

    let mergedPatch: UpdateInput;

    if (hasDirectInput) {
      const filePatch = raw.input !== undefined
        ? validateUpdateInput(raw.input)
        : raw.fromFile
          ? loadUpdatePatchFromFile(raw.fromFile)
          : undefined;
      mergedPatch = mergeFileAndFlagPatches(filePatch, {
        objective: raw.objective,
        targetUsers: raw.targetUser,
        agent: raw.agent,
        repositoryPath: effectiveRepositoryPath,
      });
    } else if (isTty()) {
      try {
        mergedPatch = await collectInteractiveInput(project);
      } catch {
        return makeResult({
          status: "needs_input",
          action: "update",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: "Interactive prompt tooling is unavailable in this process.",
          requiresHumanInput: true,
          nextRecommendedCommand: state.nextRecommendedCommand,
          exitCode: ExitCode.HumanInputRequired,
        });
      }
    } else {
      return makeResult({
        status: "needs_input",
        action: "update",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary:
          "No update input supplied and no interactive terminal is available.",
        requiresHumanInput: true,
        nextRecommendedCommand: state.nextRecommendedCommand,
        exitCode: ExitCode.HumanInputRequired,
      });
    }

    const timestamp = new Date().toISOString();
    const result = applyUpdatePatch(project, state, mergedPatch, timestamp);

    if (!result.projectChanged && !result.stateChanged) {
      return makeResult({
        status: "passed",
        action: "update",
        projectStatus: result.state.projectStatus,
        currentMilestoneId: result.state.currentMilestoneId,
        currentWorkUnitId: result.state.currentWorkUnitId,
        summary: "No changes to apply; project context is already up to date.",
        nextRecommendedCommand: result.state.nextRecommendedCommand,
        exitCode: ExitCode.Success,
        data: {
          changedFields: [],
          changedSections: [],
          createdRecordIds: [],
          updatedRecordIds: [],
          planningContextReady: result.planningContextReady,
          noOp: true,
        },
      });
    }

    let eventIds = readRunlogEventIds(paths.runlogFile);
    const relatedIds = [
      result.project.project.id,
      ...result.createdRecordIds,
      ...result.updatedRecordIds,
    ];

    const projectUpdatedEventId = nextId("EVT", eventIds);
    eventIds = [...eventIds, projectUpdatedEventId];
    const runlogEvents = [
      buildProjectUpdatedEvent({
        id: projectUpdatedEventId,
        timestamp,
        relatedIds,
        data: {
          changedFields: result.changedFields,
          changedSections: result.changedSections,
          createdRecordIds: result.createdRecordIds,
          updatedRecordIds: result.updatedRecordIds,
          planningContextReady: result.planningContextReady,
          nextRecommendedCommand: result.state.nextRecommendedCommand,
        },
      }),
    ];

    for (const decisionId of result.createdDecisionIds) {
      const decision = result.project.decisions.find((d) => d.id === decisionId);
      if (!decision) continue;
      const decisionEventId = nextId("EVT", eventIds);
      eventIds = [...eventIds, decisionEventId];
      runlogEvents.push(
        buildDecisionRecordedEvent({
          id: decisionEventId,
          timestamp,
          projectId: result.project.project.id,
          decisionId,
          decision: decision.decision,
          reason: decision.reason,
          impact: decision.impact,
        }),
      );
    }

    const writes = [];
    const changedFiles: string[] = [];
    if (result.projectChanged) {
      writes.push({
        label: "project.json",
        write: () => writeProjectModel(paths.projectFile, result.project),
      });
      changedFiles.push(paths.projectFile);
    }
    if (result.stateChanged) {
      writes.push({
        label: "state.json",
        write: () => writeStateModel(paths.stateFile, result.state),
      });
      changedFiles.push(paths.stateFile);
    }

    persistCoordinatedMutation({
      operation: "aiqt update",
      writes,
      runlogFile: paths.runlogFile,
      runlogEvents,
      recoveryHint:
        "Retry the same aiqt update input; record identity is idempotent and will not duplicate project records.",
    });
    changedFiles.push(paths.runlogFile);

    return makeResult({
      status: "passed",
      action: "update",
      projectStatus: result.state.projectStatus,
      currentMilestoneId: result.state.currentMilestoneId,
      currentWorkUnitId: result.state.currentWorkUnitId,
      summary: "Project context updated.",
      completedActions: [
        "Read project.json",
        "Updated project context",
        "Appended runlog events",
      ],
      changedFiles,
      affectedItems: [
        result.project.project.id,
        ...result.createdRecordIds,
        ...result.updatedRecordIds,
      ],
      nextRecommendedCommand: result.state.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        changedFields: result.changedFields,
        changedSections: result.changedSections,
        createdRecordIds: result.createdRecordIds,
        updatedRecordIds: result.updatedRecordIds,
        planningContextReady: result.planningContextReady,
        noOp: false,
      },
    });
  } catch (err) {
    return errorToResult("update", err);
  }
}
