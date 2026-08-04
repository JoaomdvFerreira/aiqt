import { execFileSync } from "node:child_process";

/**
 * M25 §8: one internal Git runner owned by the provider layer. Every
 * exported function here corresponds to exactly one allowlisted
 * subcommand from the specification -- there is no generic
 * `runGit(args: string[])` escape hatch, so no caller can ever pass an
 * arbitrary argument array through to `git`. `shell: false` on every
 * call means no shell string is ever interpreted (no `sh`/`cmd`/
 * PowerShell), so user-controlled values (branch names, paths) can never
 * be parsed as shell syntax; they are still validated by the branch/path
 * policy modules before reaching here, since Git itself may still
 * interpret a leading `-` as an option.
 */

const GIT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 1048576;

export class GitRunnerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GitRunnerError";
  }
}

/** M25 §8: raw stdout/stderr is bounded and never persisted to state or runlog -- only a short, sanitized first line survives into any thrown error. */
function sanitizeGitOutput(raw: string): string {
  const firstLine = (raw.split("\n")[0] ?? "").trim();
  return firstLine.slice(0, 300);
}

interface GitExecOptions {
  cwd: string;
  /** Only set true for commands whose exit code 1 is a meaningful non-error result (e.g. `diff --quiet`). */
  allowExitCodeOne?: boolean;
}

interface GitExecResult {
  stdout: string;
  /** True only when `allowExitCodeOne` was set and the process exited with code 1. */
  exitedWithCodeOne: boolean;
}

function execGit(args: readonly string[], options: GitExecOptions): GitExecResult {
  try {
    const stdout = execFileSync("git", [...args], {
      cwd: options.cwd,
      shell: false,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { stdout, exitedWithCodeOne: false };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number | null;
    };
    if (options.allowExitCodeOne && nodeErr.status === 1) {
      const stdout =
        typeof nodeErr.stdout === "string" ? nodeErr.stdout : (nodeErr.stdout?.toString("utf8") ?? "");
      return { stdout, exitedWithCodeOne: true };
    }
    const stderrText =
      typeof nodeErr.stderr === "string" ? nodeErr.stderr : (nodeErr.stderr?.toString("utf8") ?? "");
    throw new GitRunnerError(
      "GIT_COMMAND_FAILED",
      sanitizeGitOutput(stderrText || nodeErr.message || "git command failed"),
    );
  }
}

// ---------------------------------------------------------------------------
// Read-only allowlist (M25 §8).
// ---------------------------------------------------------------------------

export function gitVersion(cwd: string): string {
  return execGit(["version"], { cwd }).stdout.trim();
}

export function gitRevParse(cwd: string, ref: string): string {
  return execGit(["rev-parse", ref], { cwd }).stdout.trim();
}

export function gitIsInsideWorkTree(cwd: string): boolean {
  try {
    return execGit(["rev-parse", "--is-inside-work-tree"], { cwd }).stdout.trim() === "true";
  } catch {
    return false;
  }
}

export function gitStatusPorcelain(cwd: string): string {
  return execGit(["status", "--porcelain"], { cwd }).stdout;
}

export function gitWorktreeListPorcelain(cwd: string): string {
  return execGit(["worktree", "list", "--porcelain"], { cwd }).stdout;
}

export interface GitWorktreeListEntry {
  path: string;
  branch: string | null;
}

/** Parses `git worktree list --porcelain` output into structured entries (one per blank-line-delimited block). */
export function parseGitWorktreeListPorcelain(output: string): GitWorktreeListEntry[] {
  const entries: GitWorktreeListEntry[] = [];
  let current: GitWorktreeListEntry | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length).trim(), branch: null };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (current) entries.push(current);
  return entries;
}

export function gitCurrentBranch(cwd: string): string {
  return execGit(["branch", "--show-current"], { cwd }).stdout.trim();
}

/** Returns true when `branchName` passes `git check-ref-format --branch`, false otherwise -- never throws for an invalid (as opposed to erroring) ref. check-ref-format exits non-zero for an invalid ref, which is a meaningful "invalid" result, not a runner error. */
export function gitCheckRefFormatBranch(branchName: string, cwd: string): boolean {
  try {
    execGit(["check-ref-format", "--branch", branchName], { cwd });
    return true;
  } catch {
    return false;
  }
}

/** `git diff --quiet`: exit 0 = clean (no tracked-file differences), exit 1 = dirty. Any other exit is a real error. */
export function gitDiffQuietIsClean(cwd: string): boolean {
  const result = execGit(["diff", "--quiet"], { cwd, allowExitCodeOne: true });
  return !result.exitedWithCodeOne;
}

/**
 * M36-WU04: `git diff --numstat <baseRef>` -- raw tab-separated
 * "<inserted>\t<deleted>\t<path>" lines (or "-\t-\t<path>" for a binary
 * file), read-only, added to this repository's single central read-only
 * Git allowlist for the autonomous run's diff-summary/self-review step
 * (build spec Sec 7 WU36-04: "diff limits; changed-file checks"). Never
 * includes untracked files (matched separately via
 * gitLsFilesOthersExcludeStandard, already exported above) -- numstat
 * alone only reports tracked-file changes relative to baseRef.
 */
export function gitDiffNumstat(cwd: string, baseRef: string): string {
  return execGit(["diff", "--numstat", baseRef], { cwd }).stdout;
}

/**
 * M37-WU04: `git diff <baseRef> <headRef>` -- the full unified patch
 * text between two refs, read-only. Distinct from gitDiffNumstat (which
 * only reports per-file counts against the *working tree*): patch
 * export needs the real diff content between two committed refs in the
 * source repository, computed AFTER the run's own worktree has already
 * been removed -- only the run's `autonomous/`-prefixed branch survives
 * there (M25 never deletes branches on worktree removal), so this reads
 * directly against the source repository, not any worktree.
 */
export function gitDiffPatch(cwd: string, baseRef: string, headRef: string): string {
  return execGit(["diff", baseRef, headRef], { cwd }).stdout;
}

export function gitLsFilesOthersExcludeStandard(cwd: string): string[] {
  const out = execGit(["ls-files", "--others", "--exclude-standard"], { cwd }).stdout;
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Mutating allowlist (M25 §8) -- exactly `worktree add` and `worktree
// remove`, each with a fixed argument template. No caller can supply a
// raw argument array; branch/path/commit are separate validated strings.
// ---------------------------------------------------------------------------

/** Fixed template: `git worktree add -b <branch> <path> <commitSha>`. Never `--force`; never a user-supplied ref beyond the validated full commit SHA. */
export function gitWorktreeAdd(cwd: string, branchName: string, targetPath: string, commitSha: string): void {
  execGit(["worktree", "add", "-b", branchName, targetPath, commitSha], { cwd });
}

/** Fixed template: `git worktree remove <path>`. Never `--force`. */
export function gitWorktreeRemove(cwd: string, targetPath: string): void {
  execGit(["worktree", "remove", targetPath], { cwd });
}
