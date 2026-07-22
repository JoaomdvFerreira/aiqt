import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  gitVersion,
  gitRevParse,
  gitIsInsideWorkTree,
  gitStatusPorcelain,
  gitWorktreeListPorcelain,
  gitCurrentBranch,
  gitCheckRefFormatBranch,
  gitDiffQuietIsClean,
  gitLsFilesOthersExcludeStandard,
  gitWorktreeAdd,
  gitWorktreeRemove,
  GitRunnerError,
} from "../../src/workspaces/git-command-runner.js";
import { makeTempDir, removeDir } from "../helpers.js";

/**
 * M25 §25.5/§25.18: a real disposable Git repository fixture, not a
 * mocked git binary -- exercises the actual allowlisted commands against
 * real Git, including one full `worktree add`/`worktree remove` cycle.
 */
describe("git-command-runner (M25 §8, disposable repository)", () => {
  let repoDir: string | null = null;
  let headSha = "";

  beforeAll(() => {
    repoDir = makeTempDir("aiqt-git-runner-");
    execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repoDir });
    headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
  });

  afterAll(() => {
    if (repoDir) removeDir(repoDir);
  });

  it("gitVersion returns a real version string", () => {
    expect(gitVersion(repoDir!)).toMatch(/^git version /);
  });

  it("gitRevParse resolves HEAD to the real full commit SHA", () => {
    expect(gitRevParse(repoDir!, "HEAD")).toBe(headSha);
    expect(headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("gitIsInsideWorkTree is true for a real repository and false for a non-repository directory", () => {
    expect(gitIsInsideWorkTree(repoDir!)).toBe(true);
    const outside = makeTempDir("aiqt-not-a-repo-");
    try {
      expect(gitIsInsideWorkTree(outside)).toBe(false);
    } finally {
      removeDir(outside);
    }
  });

  it("gitStatusPorcelain is empty for a clean repository and non-empty once a file is untracked", () => {
    expect(gitStatusPorcelain(repoDir!).trim()).toBe("");
    writeFileSync(join(repoDir!, "untracked.txt"), "x");
    try {
      expect(gitStatusPorcelain(repoDir!).trim()).not.toBe("");
    } finally {
      execFileSync("git", ["clean", "-fq", "untracked.txt"], { cwd: repoDir! });
    }
  });

  it("gitDiffQuietIsClean is true for a clean tree", () => {
    expect(gitDiffQuietIsClean(repoDir!)).toBe(true);
  });

  it("gitDiffQuietIsClean is false once a tracked file is modified", () => {
    writeFileSync(join(repoDir!, "README.md"), "hello again\n");
    try {
      expect(gitDiffQuietIsClean(repoDir!)).toBe(false);
    } finally {
      execFileSync("git", ["checkout", "--quiet", "--", "README.md"], { cwd: repoDir! });
    }
  });

  it("gitLsFilesOthersExcludeStandard lists untracked files but not ignored ones", () => {
    writeFileSync(join(repoDir!, ".gitignore"), "ignored.txt\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: repoDir! });
    execFileSync("git", ["commit", "--quiet", "-m", "add gitignore"], { cwd: repoDir! });
    writeFileSync(join(repoDir!, "ignored.txt"), "x");
    writeFileSync(join(repoDir!, "tracked-untracked.txt"), "x");
    try {
      const others = gitLsFilesOthersExcludeStandard(repoDir!);
      expect(others).toContain("tracked-untracked.txt");
      expect(others).not.toContain("ignored.txt");
    } finally {
      execFileSync("git", ["clean", "-fqd"], { cwd: repoDir! });
    }
  });

  it("gitCurrentBranch reports the real current branch", () => {
    expect(gitCurrentBranch(repoDir!)).toBe("main");
  });

  it("gitCheckRefFormatBranch accepts a valid aiqt/ branch and rejects an invalid one", () => {
    expect(gitCheckRefFormatBranch("aiqt/proj/wu001-abcdef", repoDir!)).toBe(true);
    expect(gitCheckRefFormatBranch("not..valid", repoDir!)).toBe(false);
    expect(gitCheckRefFormatBranch("-leading-dash", repoDir!)).toBe(false);
  });

  it("gitWorktreeListPorcelain lists the main worktree", () => {
    expect(gitWorktreeListPorcelain(repoDir!)).toContain("worktree ");
  });

  it("gitWorktreeAdd creates a real worktree with the exact fixed template, and gitWorktreeRemove cleanly removes it while the branch survives", () => {
    mkdirSync(join(repoDir!, "..", "aiqt-worktrees"), { recursive: true });
    const worktreePath = join(repoDir!, "..", "aiqt-worktrees", "wt1");
    const branchName = "aiqt/proj/wu001-testhash1234";

    gitWorktreeAdd(repoDir!, branchName, worktreePath, headSha);
    try {
      const listing = gitWorktreeListPorcelain(repoDir!);
      expect(listing).toContain(branchName);

      gitWorktreeRemove(repoDir!, worktreePath);

      const listingAfterRemove = gitWorktreeListPorcelain(repoDir!);
      expect(listingAfterRemove).not.toContain(worktreePath.replace(/\\/g, "/"));

      // The branch itself must survive worktree removal -- M25 never
      // deletes branches.
      const branches = execFileSync("git", ["branch", "--list", branchName], {
        cwd: repoDir!,
        encoding: "utf8",
      });
      expect(branches).toContain(branchName.split("/").pop()!);
    } finally {
      try {
        gitWorktreeRemove(repoDir!, worktreePath);
      } catch {
        /* already removed */
      }
    }
  });

  it("throws a sanitized GitRunnerError (never raw multi-line output) for a genuine failure", () => {
    let threw = false;
    try {
      gitRevParse(repoDir!, "refs/does-not-exist");
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(GitRunnerError);
      expect((err as GitRunnerError).message.split("\n")).toHaveLength(1);
    }
    expect(threw).toBe(true);
  });
});
