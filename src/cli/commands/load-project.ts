import { resolve } from "node:path";
import type { CommandContext } from "../command-context.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { AiqtError } from "../../core/output/aiqt-error.js";
import type { Issue } from "../../core/output/issue.js";
import { resolveAiqtPaths, type AiqtPaths } from "../../core/filesystem/paths.js";
import { isDirectory } from "../../core/filesystem/file-exists.js";
import { readProjectModel } from "../../state/project-store.js";
import { readStateModel } from "../../state/workflow-state-store.js";
import {
  inspectRunlogHealth,
  runlogHealthWarning,
  type RunlogHealth,
} from "../../state/runlog-store.js";
import type { ProjectModel } from "../../schema/project.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface LoadedProject {
  paths: AiqtPaths;
  project: ProjectModel;
  state: StateModel;
  runlogHealth: RunlogHealth;
  warnings: Issue[];
}

/** True if an initialized .aiqt/ directory is present at the given cwd. */
export function aiqtDirExists(ctx: CommandContext): boolean {
  const paths = resolveAiqtPaths(resolve(ctx.cwd));
  return isDirectory(paths.aiqtDir);
}

/**
 * Locate .aiqt/, then read and validate project.json, state.json, and inspect
 * runlog health. Throws AiqtError (exit 3) on missing dir or invalid state.
 * Malformed runlog lines become non-blocking warnings.
 */
export function loadProject(ctx: CommandContext): LoadedProject {
  const paths = resolveAiqtPaths(resolve(ctx.cwd));

  if (!isDirectory(paths.aiqtDir)) {
    throw new AiqtError(
      `No AIQT project found at ${paths.aiqtDir}. Run aiqt init first.`,
      ExitCode.InvalidInput,
      {
        id: "AIQT-DIR-MISSING",
        severity: "critical",
        area: "filesystem",
        message: `.aiqt/ directory not found at ${paths.aiqtDir}.`,
        suggestedAction: "Run aiqt init to create a project.",
        agentCanFix: false,
      } satisfies Issue,
    );
  }

  const project = readProjectModel(paths.projectFile);
  const state = readStateModel(paths.stateFile);
  const runlogHealth = inspectRunlogHealth(paths.runlogFile);

  const warnings: Issue[] = [];
  const warning = runlogHealthWarning(runlogHealth);
  if (warning) warnings.push(warning);

  return { paths, project, state, runlogHealth, warnings };
}
