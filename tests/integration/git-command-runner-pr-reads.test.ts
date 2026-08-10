import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import {
  gitRemoteGetUrl,
  gitLsRemoteHead,
  gitLsRemoteDefaultBranch,
  gitCommitExists,
  gitIsAncestor,
  GitRunnerError,
} from "../../src/workspaces/git-command-runner.js";

// M34-WU02: this suite spawns real `git` subprocesses against real
// repositories and a real local bare remote; it belongs to the
// spawning workload class (docs/engineering/m34-validation-workload-policy.md Sec 6.1).
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M47-WU02: the real read-only Git additions, exercised against a real
 * local repository and a real local bare remote. These are the functions
 * the preflight service depends on, so they are tested directly rather
 * than only through the injected seams the integration suite uses.
 */

let workRoot: string;
let repoDir: string;
let remoteDir: string;

function git(args: string[], cwd = repoDir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(() => {
  workRoot = makeTempDir("aiqt-git-pr-reads-");
  repoDir = join(workRoot, "repo");
  remoteDir = join(workRoot, "remote.git");
  mkdirSync(repoDir, { recursive: true });
  initGitFixtureRepo(repoDir);
  execFileSync("git", ["init", "--bare", "--quiet", "-b", "main", remoteDir]);
  git(["remote", "add", "origin", remoteDir]);
  git(["push", "--quiet", "origin", "main"]);
});

afterEach(() => {
  removeDir(workRoot);
});

describe("M47-WU02 gitRemoteGetUrl", () => {
  it("returns the configured URL for an existing remote", () => {
    expect(gitRemoteGetUrl(repoDir, "origin")).toBe(remoteDir);
  });

  it("returns null for a remote that does not exist, rather than throwing", () => {
    expect(gitRemoteGetUrl(repoDir, "upstream")).toBeNull();
  });

  it("expands insteadOf rewriting, so it reports where a push would actually go", () => {
    const other = join(workRoot, "other.git");
    execFileSync("git", ["init", "--bare", "--quiet", "-b", "main", other]);
    git(["remote", "set-url", "origin", "https://github.com/acme/widget.git"]);
    git(["config", `url.${other.split("\\").join("/")}.insteadOf`, "https://github.com/acme/widget.git"]);
    expect(gitRemoteGetUrl(repoDir, "origin")).toBe(other.split("\\").join("/"));
  });
});

describe("M47-WU02 gitLsRemoteHead distinguishes present, absent, and unverifiable", () => {
  it("returns the exact SHA for a branch that exists on the remote", () => {
    expect(gitLsRemoteHead(repoDir, "origin", "main")).toBe(git(["rev-parse", "main"]));
  });

  it("returns null for a branch the remote authoritatively does not have", () => {
    expect(gitLsRemoteHead(repoDir, "origin", "no-such-branch")).toBeNull();
  });

  it("throws (rather than returning null) when the remote cannot be reached at all -- absence and ignorance are never the same answer", () => {
    git(["remote", "set-url", "origin", join(workRoot, "does-not-exist.git")]);
    expect(() => gitLsRemoteHead(repoDir, "origin", "main")).toThrow(GitRunnerError);
  });

  it("does not match a branch whose name merely shares a prefix", () => {
    git(["checkout", "--quiet", "-b", "main-2"]);
    git(["push", "--quiet", "origin", "main-2"]);
    expect(gitLsRemoteHead(repoDir, "origin", "main-2")).toBe(git(["rev-parse", "main-2"]));
    expect(gitLsRemoteHead(repoDir, "origin", "main-")).toBeNull();
  });
});

describe("M47-WU02 gitLsRemoteDefaultBranch", () => {
  it("reports the remote's default branch", () => {
    expect(gitLsRemoteDefaultBranch(repoDir, "origin")).toBe("main");
  });
});

describe("M47-WU02 gitCommitExists / gitIsAncestor underpin the fast-forward gate", () => {
  it("reports whether a commit object is present locally", () => {
    expect(gitCommitExists(repoDir, git(["rev-parse", "HEAD"]))).toBe(true);
    expect(gitCommitExists(repoDir, "0".repeat(40))).toBe(false);
    expect(gitCommitExists(repoDir, "not-a-sha")).toBe(false);
  });

  it("recognises a fast-forward and rejects a divergence", () => {
    const base = git(["rev-parse", "HEAD"]);
    writeFileSync(join(repoDir, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "--quiet", "-m", "a"]);
    const ahead = git(["rev-parse", "HEAD"]);
    expect(gitIsAncestor(repoDir, base, ahead)).toBe(true);
    expect(gitIsAncestor(repoDir, ahead, base)).toBe(false);

    git(["checkout", "--quiet", "-b", "diverged", base]);
    writeFileSync(join(repoDir, "b.txt"), "b\n");
    git(["add", "b.txt"]);
    git(["commit", "--quiet", "-m", "b"]);
    const diverged = git(["rev-parse", "HEAD"]);
    expect(gitIsAncestor(repoDir, diverged, ahead)).toBe(false);
  });
});
