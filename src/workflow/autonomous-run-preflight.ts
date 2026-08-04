import { gitDiffQuietIsClean, gitIsInsideWorkTree, gitRevParse, gitStatusPorcelain, GitRunnerError } from "../workspaces/git-command-runner.js";

/**
 * M36-WU02 (build spec Sec "Scope": "repository preflight; dirty-tree
 * detection; base-ref verification"). Unlike WU36-01's contract modules,
 * this file performs real filesystem/subprocess inspection -- but reads
 * only, through exactly the same 4 already-allowlisted, read-only Git
 * functions git-command-runner.ts (M25) exposes:
 * gitIsInsideWorkTree/gitStatusPorcelain/gitDiffQuietIsClean/gitRevParse.
 * There is no new Git invocation surface here, and nothing in this file
 * can mutate a repository -- no worktree is created, no branch is
 * created, no file is written. "No workspace mutation occurs before
 * approval" (build spec WU36-02 acceptance criterion) holds structurally:
 * this module has no mutating capability to begin with, approval or not.
 */
export interface RepositoryPreflightResult {
  isGitRepository: boolean;
  repositoryDirty: boolean;
  baseRefResolvable: boolean;
  resolvedBaseCommit: string | null;
}

/**
 * Inspects `repositoryPath` (never mutates it) and reports exactly the
 * two booleans `classifyCandidate` (WU36-01) needs: is the working tree
 * dirty, and does `baseRef` resolve to a real commit. If the path is not
 * a Git repository at all, both booleans report the safe (blocking)
 * direction -- dirty=true, resolvable=false -- since neither can be
 * meaningfully answered without a real repository, and the fail-closed
 * principle means "cannot determine" must never read as "clean/
 * resolvable."
 */
export function runRepositoryPreflight(repositoryPath: string, baseRef: string): RepositoryPreflightResult {
  const isGitRepository = gitIsInsideWorkTree(repositoryPath);
  if (!isGitRepository) {
    return { isGitRepository: false, repositoryDirty: true, baseRefResolvable: false, resolvedBaseCommit: null };
  }

  const repositoryDirty = !isWorkingTreeClean(repositoryPath);

  let resolvedBaseCommit: string | null = null;
  let baseRefResolvable = false;
  try {
    resolvedBaseCommit = gitRevParse(repositoryPath, baseRef);
    baseRefResolvable = true;
  } catch (err) {
    if (!(err instanceof GitRunnerError)) throw err;
    baseRefResolvable = false;
  }

  return { isGitRepository, repositoryDirty, baseRefResolvable, resolvedBaseCommit };
}

/**
 * "Clean" requires both no uncommitted tracked changes (gitDiffQuietIsClean)
 * and no untracked files (gitStatusPorcelain non-empty covers untracked,
 * staged, and modified-but-uncommitted alike) -- gitDiffQuietIsClean
 * alone would miss a repository with only untracked files added, which
 * is still not a trustworthy base for an autonomous run to branch from.
 */
function isWorkingTreeClean(repositoryPath: string): boolean {
  return gitDiffQuietIsClean(repositoryPath) && gitStatusPorcelain(repositoryPath).trim().length === 0;
}
