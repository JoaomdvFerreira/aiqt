import { mkdirSync, accessSync, constants as fsConstants } from "node:fs";
import { basename, resolve } from "node:path";
import type { CommandContext } from "../command-context.js";
import type { InitOptions } from "../options.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { AiqtError } from "../../core/output/aiqt-error.js";
import { AIQT_SCHEMA_VERSION } from "../../core/constants/schema-version.js";
import { resolveAiqtPaths } from "../../core/filesystem/paths.js";
import { pathExists } from "../../core/filesystem/file-exists.js";
import {
  buildInitialProjectModel,
  writeProjectModel,
} from "../../state/project-store.js";
import {
  buildInitialStateModel,
  writeStateModel,
} from "../../state/workflow-state-store.js";
import {
  buildProjectInitializedEvent,
  appendRunlogEvent,
} from "../../state/runlog-store.js";
import { formatId } from "../../state/ids.js";
import { resolveRoots } from "../../workflow/root-resolution.js";
import { applyWorkflowAssessmentToState } from "../../services/workflow-assessment-persistence.js";

function blocked(message: string, area: string): AiqtError {
  return new AiqtError(message, ExitCode.InvalidInput, {
    id: "INIT-BLOCKED",
    severity: "critical",
    area,
    message,
    agentCanFix: false,
  });
}

export function runInit(
  ctx: CommandContext,
  options: InitOptions,
): CommandResult {
  try {
    const root = resolve(ctx.cwd);
    const paths = resolveAiqtPaths(root);

    // 1. Verify current folder is writable.
    try {
      accessSync(root, fsConstants.W_OK);
    } catch {
      throw blocked(`Current folder is not writable: ${root}`, "filesystem");
    }

    // 2. Verify .aiqt/ does not already exist.
    if (pathExists(paths.aiqtDir)) {
      throw blocked(
        `.aiqt/ already exists at ${paths.aiqtDir}. AIQT will not overwrite an existing project.`,
        "init",
      );
    }

    // 3. Derive project name from the current folder.
    const projectName = basename(root) || "aiqt-project";
    const now = new Date().toISOString();
    const projectId = "PROJECT-001";
    let nextRecommendedCommand = "aiqt update";

    // 4-9. Create canonical files.
    try {
      mkdirSync(paths.aiqtDir, { recursive: false });
      mkdirSync(paths.exportsDir, { recursive: true });

      const projectModel = buildInitialProjectModel({
        id: projectId,
        name: projectName,
        objective: options.objective,
        targetUsers: options.targetUsers,
        preferredAgent: options.preferredAgent,
        createdAt: now,
        existingRepositoryPath: options.existingRepositoryPath,
      });
      writeProjectModel(paths.projectFile, projectModel);

      const stateModel = applyWorkflowAssessmentToState(projectModel, buildInitialStateModel(now));
      nextRecommendedCommand = stateModel.nextRecommendedCommand ?? nextRecommendedCommand;
      writeStateModel(paths.stateFile, stateModel);

      // runlog.jsonl must exist before appending the event.
      appendRunlogEvent(
        paths.runlogFile,
        buildProjectInitializedEvent({
          id: formatId("EVT", 1),
          projectId,
          timestamp: now,
          schemaVersion: AIQT_SCHEMA_VERSION,
        }),
      );
    } catch (writeErr) {
      if (writeErr instanceof AiqtError) throw writeErr;
      throw blocked(
        `Failed to write canonical AIQT files: ${(writeErr as Error).message}`,
        "filesystem",
      );
    }

    // M16 §6/§12: implementationRoot resolves to controlRoot when no
    // --implementation-root was supplied; aiqt init never inspects Git.
    const roots = resolveRoots({ controlRoot: root, existingRepositoryPath: options.existingRepositoryPath });

    return makeResult({
      status: "passed",
      action: "init",
      projectStatus: "draft",
      summary: `Initialized AIQT project "${projectName}" in ${paths.aiqtDir}. AIQT control root: ${roots.controlRoot}. Implementation root: ${roots.implementationRoot}.`,
      exitCode: ExitCode.Success,
      completedActions: [
        "Created .aiqt/ directory",
        "Created project.json",
        "Created state.json",
        "Created runlog.jsonl",
        "Created exports/ directory",
        "Appended project.initialized event",
      ],
      changedFiles: [
        paths.projectFile,
        paths.stateFile,
        paths.runlogFile,
      ],
      nextRecommendedCommand,
      data: {
        projectId,
        projectName,
        schemaVersion: AIQT_SCHEMA_VERSION,
        roots,
      },
    });
  } catch (err) {
    return errorToResult("init", err);
  }
}
