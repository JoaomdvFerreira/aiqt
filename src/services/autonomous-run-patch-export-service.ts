import { gitDiffPatch, gitCheckRefFormatBranch, GitRunnerError } from "../workspaces/git-command-runner.js";
import { isAiqtOwnRepository } from "../workflow/autonomous-run-self-management-guard.js";

/**
 * M37-WU04 (build spec Sec 7 WU37-04 Scope: "patch export"). Real,
 * read-only: exports the unified diff between a run's recorded
 * baseCommit and its `autonomous/`-prefixed branch, directly from the
 * source repository -- the run's own worktree is already gone by the
 * time an operator asks for a patch (produceAutonomousEvidencePacket's
 * cleanup already ran), but the branch itself survives there (M25 never
 * deletes branches). No worktree is created or touched by this
 * function; it only ever reads.
 */
export type ExportAutonomousRunPatchResult = { ok: true; patch: string } | { ok: false; reason: string };

export function exportAutonomousRunPatch(repositoryPath: string, baseCommit: string, branch: string): ExportAutonomousRunPatchResult {
  if (isAiqtOwnRepository(repositoryPath)) {
    return { ok: false, reason: "Refusing to export a patch from the AIQT product's own repository (self-management is never permitted)." };
  }
  if (!gitCheckRefFormatBranch(branch, repositoryPath)) {
    return { ok: false, reason: `"${branch}" is not a valid Git ref.` };
  }
  try {
    const patch = gitDiffPatch(repositoryPath, baseCommit, branch);
    return { ok: true, patch };
  } catch (err) {
    if (!(err instanceof GitRunnerError)) throw err;
    return { ok: false, reason: `Failed to export patch: ${err.message}` };
  }
}
