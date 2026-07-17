import { spawnSync } from "node:child_process";

/**
 * M19 §21: every git invocation here uses spawnSync with an argument array
 * (never a shell string), so a malicious or malformed ref/path can never be
 * interpreted as shell syntax. `shell: false` (the default) is relied upon
 * explicitly -- never set `shell: true` in this module.
 */
export class GitCommandError extends Error {
  constructor(
    public readonly args: readonly string[],
    public readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed: ${stderr.trim() || "(no stderr)"}`);
    this.name = "GitCommandError";
  }
}

function runGit(args: readonly string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) {
    throw new GitCommandError(args, result.error.message);
  }
  if (result.status !== 0) {
    throw new GitCommandError(args, result.stderr ?? "");
  }
  return result.stdout;
}

/** Resolve a ref (branch, tag, remote ref, or commit-ish) to a full commit SHA. Throws GitCommandError if unresolvable. */
export function resolveRef(ref: string, cwd: string): string {
  return runGit(["rev-parse", "--verify", `${ref}^{commit}`], cwd).trim();
}

/** The merge-base commit of two refs -- the common ancestor used for deterministic PR-style comparison. */
export function mergeBase(refA: string, refB: string, cwd: string): string {
  return runGit(["merge-base", refA, refB], cwd).trim();
}

/**
 * Repository-relative paths changed between two revisions, using the same
 * comparison `git diff base...head` performs internally (diff against the
 * merge-base of `base` and `head`, not a literal two-dot diff). Deduplicated
 * and sorted for deterministic output.
 */
export function changedPathsSince(baseRef: string, headRef: string, cwd: string): string[] {
  const base = mergeBase(baseRef, headRef, cwd);
  const stdout = runGit(["diff", "--name-only", `${base}`, `${headRef}`], cwd);
  const paths = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return [...new Set(paths)].sort();
}

/** Read a file's content as it existed at a specific revision, without touching the working tree. */
export function readFileAtRevision(revision: string, path: string, cwd: string): string {
  return runGit(["show", `${revision}:${path}`], cwd);
}

/** True if `ref` resolves to a valid commit in this repository. */
export function refExists(ref: string, cwd: string): boolean {
  try {
    resolveRef(ref, cwd);
    return true;
  } catch {
    return false;
  }
}
