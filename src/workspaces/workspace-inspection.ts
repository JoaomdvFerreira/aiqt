import { existsSync, realpathSync } from "node:fs";
import {
  gitDiffQuietIsClean,
  gitLsFilesOthersExcludeStandard,
  gitStatusPorcelain,
  gitWorktreeListPorcelain,
  gitCurrentBranch,
  parseGitWorktreeListPorcelain,
} from "./git-command-runner.js";

/**
 * M25 §10.1/§12.2/§15: read-only inspection of an isolated (git-worktree@1)
 * workspace's physical reality -- used by release preconditions and by
 * `workspace recover` to decide finalize/clear/block per §15.1/§15.2. Never
 * mutates anything; only Git-runner reads (WU25-02) and filesystem stat
 * calls.
 */
export interface IsolatedWorkspaceInspection {
  /** The path exists on disk. */
  exists: boolean;
  /** Git (run from implementationRoot) lists this exact real path as a registered worktree. */
  registered: boolean;
  /** The registered worktree's current branch matches the canonical/expected branch. */
  branchMatches: boolean;
  /** No tracked-file diff and no untracked files inside the workspace. */
  clean: boolean;
  /** A merge/rebase/cherry-pick conflict is unresolved (any porcelain status code containing "U", or "AA"/"DD"). */
  hasUnresolvedConflict: boolean;
}

const CONFLICT_CODES = new Set(["DD", "AA", "UU", "AU", "UA", "DU", "UD"]);

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

export function inspectIsolatedWorkspace(params: {
  implementationRoot: string;
  workspacePath: string;
  expectedBranch: string;
}): IsolatedWorkspaceInspection {
  const exists = existsSync(params.workspacePath);
  const expectedRealPath = exists ? realpathOrNull(params.workspacePath) : null;

  const listing = parseGitWorktreeListPorcelain(gitWorktreeListPorcelain(params.implementationRoot));
  const entry = expectedRealPath
    ? listing.find((e) => existsSync(e.path) && realpathOrNull(e.path) === expectedRealPath)
    : undefined;
  const registered = entry !== undefined;

  let branchMatches = false;
  let clean = false;
  let hasUnresolvedConflict = false;

  if (registered && exists) {
    const actualBranch = gitCurrentBranch(params.workspacePath);
    branchMatches = actualBranch === params.expectedBranch;
    clean = gitDiffQuietIsClean(params.workspacePath) && gitLsFilesOthersExcludeStandard(params.workspacePath).length === 0;
    const statusLines = gitStatusPorcelain(params.workspacePath)
      .split("\n")
      .map((line) => line.slice(0, 2))
      .filter((code) => code.length === 2);
    hasUnresolvedConflict = statusLines.some((code) => CONFLICT_CODES.has(code));
  }

  return { exists, registered, branchMatches, clean, hasUnresolvedConflict };
}
