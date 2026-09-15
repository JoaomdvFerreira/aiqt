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

/** Read-only, bounded changed-path facts for a committed revision range. */
export function gitDiffNameStatus(cwd: string, baseRef: string, headRef: string): string {
  return execGit(["diff", "--name-status", baseRef, headRef], { cwd }).stdout;
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

/** All local tag names, unsorted (M44-WU02 historical-target discovery). */
export function gitListTags(cwd: string): string[] {
  const out = execGit(["tag", "--list"], { cwd }).stdout;
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Content of `path` as it existed at `commit`, or null if the path did not
 * exist at that commit (M44-WU02: historical package/schema-version
 * reconstruction). `commit` must already be a resolved sha or verified ref
 * -- callers never pass raw operator strings here unvalidated.
 */
export function gitShowFileAtCommit(cwd: string, commit: string, path: string): string | null {
  try {
    return execGit(["show", `${commit}:${path}`], { cwd }).stdout;
  } catch (err) {
    if (err instanceof GitRunnerError) return null;
    throw err;
  }
}

/**
 * True if `ancestorCommit` is an ancestor of (or equal to) `descendantCommit`
 * (M44-WU02 ancestry-aware base-release selection). `git merge-base
 * --is-ancestor` exits 1 for "not an ancestor", which is a meaningful
 * boolean result here, not a runner error.
 */
export function gitIsAncestor(cwd: string, ancestorCommit: string, descendantCommit: string): boolean {
  const result = execGit(["merge-base", "--is-ancestor", ancestorCommit, descendantCommit], {
    cwd,
    allowExitCodeOne: true,
  });
  return !result.exitedWithCodeOne;
}

/** Author-date commit timestamp in strict ISO 8601, or null if `commit` cannot be resolved (M44-WU02: Git metadata only, never wall-clock "now"). */
export function gitCommitTimeIso(cwd: string, commit: string): string | null {
  try {
    return execGit(["log", "-1", "--format=%cI", commit], { cwd }).stdout.trim() || null;
  } catch (err) {
    if (err instanceof GitRunnerError) return null;
    throw err;
  }
}

/**
 * M47-WU02: `git remote get-url <name>` -- read-only. Returns the
 * configured fetch URL for one named remote, or null when the remote does
 * not exist (which `git` reports as a non-zero exit, a meaningful "no such
 * remote" result rather than a runner error). The URL may embed a
 * credential (`https://user:token@host/...`), so callers must never place
 * this value in a CommandResult, a persisted plan, or an error message --
 * parse it to an `owner/repo` identity (workflow/pr-remote-identity.ts)
 * and surface only that.
 */
export function gitRemoteGetUrl(cwd: string, remoteName: string): string | null {
  try {
    return execGit(["remote", "get-url", remoteName], { cwd }).stdout.trim() || null;
  } catch (err) {
    if (err instanceof GitRunnerError) return null;
    throw err;
  }
}

/**
 * M47-WU02: `git ls-remote --heads <remote> refs/heads/<branch>` -- the
 * bounded remote branch lookup. This is a NETWORK read (it contacts the
 * remote), but it is read-only: `ls-remote` has no mutating form.
 *
 * The three outcomes are deliberately distinct, because conflating them
 * is exactly the hazard M47 exists to avoid: a matching line means the
 * branch exists at that SHA, empty output means the remote authoritatively
 * has no such branch, and a thrown GitRunnerError means we could not find
 * out (auth failure, network failure, unreachable host). A caller must
 * never treat the third as the second -- "absent" authorizes a
 * create-style push, "unverifiable" must not.
 */
export function gitLsRemoteHead(cwd: string, remoteName: string, branch: string): string | null {
  const out = execGit(["ls-remote", "--heads", remoteName, `refs/heads/${branch}`], { cwd }).stdout;
  for (const line of out.split("\n")) {
    const [sha, ref] = line.trim().split("\t");
    if (sha && ref === `refs/heads/${branch}`) return sha;
  }
  return null;
}

/**
 * M47-WU02: `git ls-remote --symref <remote> HEAD` -- read-only discovery
 * of the remote's default branch, so a push can be refused when the source
 * branch IS the default branch even if the operator named a different
 * base. Returns null when the remote did not report a symref (older
 * servers), which is treated as "could not verify", never as "there is no
 * default branch".
 */
export function gitLsRemoteDefaultBranch(cwd: string, remoteName: string): string | null {
  const out = execGit(["ls-remote", "--symref", remoteName, "HEAD"], { cwd }).stdout;
  for (const line of out.split("\n")) {
    const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line.trim());
    if (match) return match[1]!;
  }
  return null;
}

/**
 * M47-WU02: `git cat-file -e <sha>^{commit}` -- whether this repository
 * has the given commit object locally. Used before any ancestry check: a
 * remote SHA that is not present locally cannot be reasoned about, so the
 * fast-forward decision must fail closed rather than assume. Exit 1 means
 * "not present", a meaningful result, not a runner error.
 */
export function gitCommitExists(cwd: string, sha: string): boolean {
  try {
    const result = execGit(["cat-file", "-e", `${sha}^{commit}`], { cwd, allowExitCodeOne: true });
    return !result.exitedWithCodeOne;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mutating allowlist (M25 §8, extended once by M47 §8) -- `worktree add`,
// `worktree remove`, and exactly one non-force, single-ref, exact-commit
// branch push, each with a fixed argument template. No caller can supply a
// raw argument array; branch/path/commit/remote are separate validated
// strings. There is no force, force-with-lease, delete, tag, wildcard, or
// multi-ref push anywhere in this file, and no way for a caller to
// construct one.
// ---------------------------------------------------------------------------

/** Fixed template: `git worktree add -b <branch> <path> <commitSha>`. Never `--force`; never a user-supplied ref beyond the validated full commit SHA. */
export function gitWorktreeAdd(cwd: string, branchName: string, targetPath: string, commitSha: string): void {
  execGit(["worktree", "add", "-b", branchName, targetPath, commitSha], { cwd });
}

/** Fixed template: `git worktree remove <path>`. Never `--force`. */
export function gitWorktreeRemove(cwd: string, targetPath: string): void {
  execGit(["worktree", "remove", targetPath], { cwd });
}

/**
 * M47-WU03 (build spec Sec 8): the ONLY remote-write operation in this
 * repository, and the only entry ever added to this file's mutating
 * allowlist for a network destination.
 *
 * Fixed template: `git push <remote> <sha>:refs/heads/<branch>`.
 *
 * What the shape itself guarantees, independent of any caller:
 * - the source of the push is a resolved commit SHA, never a ref name, so
 *   what lands is exactly the reviewed commit and cannot drift between
 *   the decision and the write;
 * - the destination is one fully-qualified `refs/heads/` ref, so no
 *   wildcard, no `--all`, no `--mirror`, no tag ref, and no second ref can
 *   ride along;
 * - the refspec has no leading `+` and no `--force`/`--force-with-lease`
 *   flag exists anywhere in this template, so a non-fast-forward update is
 *   rejected by the remote itself -- the guarantee does not depend on
 *   AIQT's own preflight being correct;
 * - the source side is never empty, so this can never express a ref
 *   deletion (`git push <remote> :refs/heads/<branch>`).
 *
 * Callers MUST validate `commitSha` as a full 40-hex SHA and `branch` via
 * gitCheckRefFormatBranch first; both are re-checked here, because this is
 * the last point before a real remote mutation and a wrong value here
 * cannot be undone by AIQT (it has no force, delete, or revert capability).
 *
 * Throws GitRunnerError on any failure. A thrown error means the push did
 * not demonstrably succeed -- it does NOT mean nothing happened, since a
 * connection can drop after the remote has already accepted the update.
 * Resolving that is the caller's job (pr-push-service.ts re-reads the
 * remote SHA and records `ambiguous` rather than guessing).
 */
export function gitPushExactCommitToBranch(cwd: string, remoteName: string, commitSha: string, branch: string): string {
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new GitRunnerError("GIT_PUSH_INVALID_COMMIT", "Refusing to push: the source must be a full 40-character commit SHA.");
  }
  if (branch.length === 0 || branch.startsWith("-") || branch.includes(":") || branch.includes("*") || branch.includes("?")) {
    throw new GitRunnerError("GIT_PUSH_INVALID_BRANCH", "Refusing to push: the destination branch name is not a plain branch name.");
  }
  if (remoteName.length === 0 || remoteName.startsWith("-")) {
    throw new GitRunnerError("GIT_PUSH_INVALID_REMOTE", "Refusing to push: the remote name is not a plain remote name.");
  }
  return execGit(["push", "--porcelain", remoteName, `${commitSha}:refs/heads/${branch}`], { cwd }).stdout;
}
