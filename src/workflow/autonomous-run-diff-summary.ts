import { gitDiffNumstat, gitLsFilesOthersExcludeStandard } from "../workspaces/git-command-runner.js";
import type { AutonomousDiffSummary } from "../schema/autonomous-run.schema.js";

/**
 * M36-WU04 (build spec Sec 7 WU36-04 Scope: "diff limits; changed-file
 * checks"; threat model Sec 3.20 "hidden generated-file changes"). Real
 * (read-only) diff inspection: parses `git diff --numstat` and
 * `git ls-files --others --exclude-standard` (both already-allowlisted
 * read-only git-command-runner.ts functions -- the second reused
 * verbatim from M25's own worktree-hygiene use, the first added in this
 * Work Unit) into a structural AutonomousDiffSummary. No mutation.
 */

/**
 * Files matching any of these patterns are always reported as
 * `unexpectedFiles`, regardless of what the candidate's own scope claims
 * -- this is the concrete mechanism closing threat model Sec 3.20 and
 * Sec 6.3's `generated_lockfile_rewrite`/`dependency_chain_upgrade`
 * prohibited-area concept at the *diff* level, not just the *candidate-
 * tag* level (WU36-01's classifyCandidate only catches a lockfile
 * change if the candidate honestly declared it -- this catches one that
 * happened without being declared).
 */
const ALWAYS_UNEXPECTED_PATTERNS: RegExp[] = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)\.git\//,
];

interface NumstatLine {
  insertedLines: number;
  deletedLines: number;
  path: string;
  binary: boolean;
}

/**
 * `git diff --numstat`'s third field is not always a plain path -- a
 * rename reports it as `"old => new"` (whole-path rename) or
 * `"prefix/{old => new}/suffix"` (partial/directory rename, abbreviated).
 * Resolving to the destination path is required for
 * ALWAYS_UNEXPECTED_PATTERNS to have any chance of matching a rename
 * that moves a file INTO a lockfile name (threat model Sec 3.20) --
 * matching the raw "old => new" string against `/pnpm-lock\.yaml$/`
 * would only work by the coincidence of the destination being last, and
 * fails entirely for the `{...}` abbreviated form.
 */
function resolveDestinationPath(rawPath: string): string {
  const braceMatch = rawPath.match(/^(.*)\{.* => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, to, suffix] = braceMatch;
    return `${prefix}${to}${suffix}`;
  }
  const arrowMatch = rawPath.match(/^.* => (.*)$/);
  if (arrowMatch) {
    return arrowMatch[1];
  }
  return rawPath;
}

function parseNumstat(raw: string): NumstatLine[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [insertedRaw, deletedRaw, rawPath] = line.split("\t");
      const binary = insertedRaw === "-" || deletedRaw === "-";
      return {
        insertedLines: binary ? 0 : Number.parseInt(insertedRaw, 10),
        deletedLines: binary ? 0 : Number.parseInt(deletedRaw, 10),
        path: resolveDestinationPath(rawPath),
        binary,
      };
    });
}

function isAlwaysUnexpected(path: string): boolean {
  return ALWAYS_UNEXPECTED_PATTERNS.some((p) => p.test(path));
}

/**
 * `baseCommit` is the run's own recorded base (AutonomousWorkspaceRecord.
 * baseCommit), never a caller-suppliable arbitrary ref -- the diff is
 * always relative to the exact commit the worktree was created from.
 */
export function captureAutonomousDiffSummary(worktreePath: string, baseCommit: string): AutonomousDiffSummary {
  const tracked = parseNumstat(gitDiffNumstat(worktreePath, baseCommit));
  const untracked = gitLsFilesOthersExcludeStandard(worktreePath);

  const changedFiles = tracked.length + untracked.length;
  const insertedLines = tracked.reduce((sum, l) => sum + l.insertedLines, 0);
  const deletedLines = tracked.reduce((sum, l) => sum + l.deletedLines, 0);

  const unexpectedFiles = [
    ...tracked.map((l) => l.path).filter(isAlwaysUnexpected),
    ...untracked.filter(isAlwaysUnexpected),
  ];

  return { changedFiles, insertedLines, deletedLines, unexpectedFiles };
}

/**
 * The evidence packet's top-level `filesChanged` (build spec Sec 6.7) is a
 * flat path list, distinct from `AutonomousDiffSummary`'s counts-only
 * shape (fixed by WU36-01's schema) -- this is the same tracked/untracked
 * data captureAutonomousDiffSummary already reads, exposed as paths for
 * the evidence-binding service (WU36-04) instead of being re-derived.
 */
export function listAutonomousChangedFilePaths(worktreePath: string, baseCommit: string): string[] {
  const tracked = parseNumstat(gitDiffNumstat(worktreePath, baseCommit)).map((l) => l.path);
  const untracked = gitLsFilesOthersExcludeStandard(worktreePath);
  return [...tracked, ...untracked];
}
