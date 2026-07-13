import { join } from "node:path";

export const AIQT_DIR_NAME = ".aiqt";

export interface AiqtPaths {
  root: string;
  aiqtDir: string;
  projectFile: string;
  stateFile: string;
  runlogFile: string;
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
    exportsDir: join(aiqtDir, "exports"),
    inputsDir: join(aiqtDir, "inputs"),
  };
}
