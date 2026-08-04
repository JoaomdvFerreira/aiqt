import { gitWorktreeAdd, gitWorktreeRemove, gitIsInsideWorkTree, gitCheckRefFormatBranch, GitRunnerError } from "./git-command-runner.js";
import { validateWorkspaceRoot, deriveWorkspacePath } from "./workspace-path-policy.js";
import { isValidAutonomousRunBranchShape } from "../workflow/autonomous-run-branch-policy.js";

/**
 * M36-WU03 (build spec Sec 7 WU36-03 Scope: "worktree creation"; Sec 6.2:
 * "Preferred implementation: git worktree add -b <run-branch> <isolated-
 * path> <base-ref>"). Real, mutating -- this is the one M36 module
 * allowed to call gitWorktreeAdd/gitWorktreeRemove (git-command-runner.ts's
 * mutating allowlist), and it calls nothing else mutating.
 *
 * Deliberately built directly on git-command-runner.ts's raw primitives
 * plus workspace-path-policy.ts's pure path-safety functions (symlink/
 * traversal/home-dir/filesystem-root rejection, reused verbatim, not
 * reimplemented) -- NOT on workspace-service.ts's
 * prepareIsolatedWorkspace/releaseIsolatedWorkspace. Those M25 functions
 * require a full StateModel, AiqtPaths, and a project/work-unit id pair
 * from AIQT's own canonical state -- i.e. they assume the target
 * repository IS an AIQT-tracked project. An autonomous run's target
 * repository is explicitly not required to be one (build spec Sec 2:
 * "inspect a target repository," never framed as an AIQT project), so
 * reusing them here would wrongly force that coupling. This corrects
 * WU36-01's own architecture-ownership table (docs/engineering/
 * m36-autonomous-run-contract.md Sec 2.3), which listed both files
 * together without yet having implemented enough to discover the
 * distinction -- recorded honestly in this Work Unit's own addendum
 * (Sec 10.1) rather than silently changed.
 */
export interface CreateAutonomousWorktreeParams {
  sourceRepositoryPath: string;
  baseCommit: string;
  branchName: string;
  workspaceRoot: string;
  workspaceId: string;
}

export type CreateAutonomousWorktreeResult =
  | { ok: true; worktreePath: string }
  | { ok: false; reason: string };

/**
 * Validates every input before ever calling gitWorktreeAdd: the source
 * must be a real Git repository, the branch name must match this
 * module's own fixed `autonomous/` shape AND pass Git's own
 * check-ref-format, and the workspace root must pass
 * validateWorkspaceRoot's full symlink/traversal/home-dir/filesystem-
 * root check. Any failure returns `ok: false` with no worktree created
 * -- fail-closed, matching the rest of this milestone's contract.
 */
export function createAutonomousWorktree(params: CreateAutonomousWorktreeParams): CreateAutonomousWorktreeResult {
  const { sourceRepositoryPath, baseCommit, branchName, workspaceRoot, workspaceId } = params;

  if (!gitIsInsideWorkTree(sourceRepositoryPath)) {
    return { ok: false, reason: "sourceRepositoryPath is not a valid Git repository." };
  }
  if (!isValidAutonomousRunBranchShape(branchName)) {
    return { ok: false, reason: `Branch name "${branchName}" does not match the required autonomous/ shape.` };
  }
  if (!gitCheckRefFormatBranch(branchName, sourceRepositoryPath)) {
    return { ok: false, reason: `Branch name "${branchName}" is not a valid Git ref.` };
  }
  const rootValidation = validateWorkspaceRoot(workspaceRoot, sourceRepositoryPath);
  if (!rootValidation.ok) {
    return { ok: false, reason: `Invalid workspace root: ${rootValidation.reason}` };
  }

  const worktreePath = deriveWorkspacePath(workspaceRoot, workspaceId);

  try {
    gitWorktreeAdd(sourceRepositoryPath, branchName, worktreePath, baseCommit);
  } catch (err) {
    if (!(err instanceof GitRunnerError)) throw err;
    return { ok: false, reason: `git worktree add failed: ${err.message}` };
  }

  return { ok: true, worktreePath };
}

export type RemoveAutonomousWorktreeResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Always attempted on run completion, failure, or cancellation (build
 * spec Sec 6.2/threat model Sec 3.19) -- callers must call this exactly
 * once per successfully created worktree and record the outcome via
 * AutonomousWorkspaceRecordSchema.cleanupStatus (WU36-01), never silently
 * swallow a failure.
 */
export function removeAutonomousWorktree(sourceRepositoryPath: string, worktreePath: string): RemoveAutonomousWorktreeResult {
  try {
    gitWorktreeRemove(sourceRepositoryPath, worktreePath);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof GitRunnerError)) throw err;
    return { ok: false, reason: `git worktree remove failed: ${err.message}` };
  }
}
