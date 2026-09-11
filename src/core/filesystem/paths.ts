import { join } from "node:path";

export const AIQT_DIR_NAME = ".aiqt";
export const PROJECT_MUTATION_MARKER_FILE_NAME = "mutation-interruption.json";
export const PROJECT_MUTATION_LOCK_FILE_NAME = "mutation.lock";

export interface AiqtPaths {
  root: string;
  aiqtDir: string;
  projectFile: string;
  stateFile: string;
  runlogFile: string;
  /** M49-WU3: transient, durable evidence that a supported mutation began. */
  mutationMarkerFile: string;
  /** M49-WU3: project-local exclusive lock for supported mutations. */
  mutationLockFile: string;
  exportsDir: string;
  /** Non-canonical, optional working area for M7 prompts/agent-produced JSON. Not created by init. */
  inputsDir: string;
}

/** Resolve all canonical AIQT paths relative to a project root folder. */
export function resolveAiqtPaths(root: string): AiqtPaths {
  const aiqtDir = join(root, AIQT_DIR_NAME);
  return {
    root,
    aiqtDir,
    projectFile: join(aiqtDir, "project.json"),
    stateFile: join(aiqtDir, "state.json"),
    runlogFile: join(aiqtDir, "runlog.jsonl"),
    mutationMarkerFile: join(aiqtDir, PROJECT_MUTATION_MARKER_FILE_NAME),
    mutationLockFile: join(aiqtDir, PROJECT_MUTATION_LOCK_FILE_NAME),
    exportsDir: join(aiqtDir, "exports"),
    inputsDir: join(aiqtDir, "inputs"),
  };
}
