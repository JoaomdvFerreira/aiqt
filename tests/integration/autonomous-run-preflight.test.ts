import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { runRepositoryPreflight } from "../../src/workflow/autonomous-run-preflight.js";

// M36-WU02: this file spawns real subprocesses (git, via
// git-command-runner.ts's read-only allowlist); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M36-WU02: exercises runRepositoryPreflight against a real disposable
 * Git repository (M25 §25.5/§25.18 pattern, reused via M35-WU03's shared
 * initGitFixtureRepo helper) -- not mocks. Confirms the preflight is
 * genuinely read-only: every test's repository is inspected, never
 * mutated by the function under test itself (only this test's own setup
 * code writes to the repo).
 */
describe("runRepositoryPreflight (M36-WU02, real disposable repository)", () => {
  let repoDir: string | null = null;
  let headSha = "";

  beforeAll(() => {
    repoDir = makeTempDir("aiqt-preflight-");
    headSha = initGitFixtureRepo(repoDir);
  });

  afterAll(() => {
    if (repoDir) removeDir(repoDir);
  });

  it("reports a clean repository and a resolvable base ref", () => {
    const result = runRepositoryPreflight(repoDir!, "HEAD");
    expect(result.isGitRepository).toBe(true);
    expect(result.repositoryDirty).toBe(false);
    expect(result.baseRefResolvable).toBe(true);
    expect(result.resolvedBaseCommit).toBe(headSha);
  });

  it("resolves a named branch ref (main) to the same commit as HEAD", () => {
    const result = runRepositoryPreflight(repoDir!, "main");
    expect(result.baseRefResolvable).toBe(true);
    expect(result.resolvedBaseCommit).toBe(headSha);
  });

  it("reports an unresolvable base ref as such, without throwing", () => {
    const result = runRepositoryPreflight(repoDir!, "refs/heads/does-not-exist");
    expect(result.baseRefResolvable).toBe(false);
    expect(result.resolvedBaseCommit).toBeNull();
    // The repository's own dirty/clean status is independent of whether
    // the requested ref resolves -- an unresolvable ref must not be
    // reported as "the repository is also dirty" just because something
    // else about the request was wrong.
    expect(result.repositoryDirty).toBe(false);
  });

  it("reports a dirty repository once an untracked file is added, and clean again once removed", () => {
    const untrackedPath = join(repoDir!, "untracked.txt");
    writeFileSync(untrackedPath, "x");
    try {
      const dirtyResult = runRepositoryPreflight(repoDir!, "HEAD");
      expect(dirtyResult.repositoryDirty).toBe(true);
    } finally {
      execFileSync("git", ["clean", "-fq", "untracked.txt"], { cwd: repoDir! });
    }
    const cleanResult = runRepositoryPreflight(repoDir!, "HEAD");
    expect(cleanResult.repositoryDirty).toBe(false);
  });

  it("reports a dirty repository once a tracked file is modified (uncommitted), and clean again once reverted", () => {
    const readmePath = join(repoDir!, "README.md");
    writeFileSync(readmePath, "modified\n");
    try {
      const dirtyResult = runRepositoryPreflight(repoDir!, "HEAD");
      expect(dirtyResult.repositoryDirty).toBe(true);
    } finally {
      execFileSync("git", ["checkout", "--quiet", "--", "README.md"], { cwd: repoDir! });
    }
    const cleanResult = runRepositoryPreflight(repoDir!, "HEAD");
    expect(cleanResult.repositoryDirty).toBe(false);
  });

  it("preflight itself never mutates the repository (HEAD and status are unchanged after 5 consecutive calls)", () => {
    for (let i = 0; i < 5; i++) runRepositoryPreflight(repoDir!, "HEAD");
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir!, encoding: "utf8" }).trim()).toBe(headSha);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repoDir!, encoding: "utf8" }).trim()).toBe("");
  });

  it("reports isGitRepository: false and fails closed (dirty=true, unresolvable) for a non-Git directory", () => {
    const nonRepoDir = makeTempDir("aiqt-not-a-repo-");
    try {
      const result = runRepositoryPreflight(nonRepoDir, "HEAD");
      expect(result.isGitRepository).toBe(false);
      expect(result.repositoryDirty).toBe(true);
      expect(result.baseRefResolvable).toBe(false);
      expect(result.resolvedBaseCommit).toBeNull();
    } finally {
      removeDir(nonRepoDir);
    }
  });
});
