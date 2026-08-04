import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { exportAutonomousRunPatch } from "../../src/services/autonomous-run-patch-export-service.js";

// M37-WU04: this file spawns real subprocesses (git). See
// docs/engineering/m34-validation-workload-policy.md Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M37-WU04 (build spec: "patch export"). Real, read-only: exports the
 * diff between a run's baseCommit and its branch directly from the
 * source repository -- exercised against a real disposable, non-AIQT
 * repository with an actual `autonomous/`-prefixed branch, matching
 * what a real run leaves behind after its worktree is cleaned up.
 */
describe("exportAutonomousRunPatch (M37-WU04, real disposable repository)", () => {
  let repoDir: string | null = null;
  let headSha = "";

  beforeEach(() => {
    repoDir = makeTempDir("aiqt-patch-export-");
    headSha = initGitFixtureRepo(repoDir);
  });

  afterEach(() => {
    if (repoDir) removeDir(repoDir);
  });

  it("exports a real unified diff between baseCommit and an autonomous/ branch", () => {
    execFileSync("git", ["checkout", "-b", "autonomous/issue-1-run-1", headSha], { cwd: repoDir! });
    writeFileSync(join(repoDir!, "README.md"), "hello\nworld\n");
    execFileSync("git", ["commit", "-am", "AIQT autonomous repair"], { cwd: repoDir! });
    execFileSync("git", ["checkout", "main"], { cwd: repoDir! });

    const result = exportAutonomousRunPatch(repoDir!, headSha, "autonomous/issue-1-run-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toContain("README.md");
      expect(result.patch).toContain("+world");
    }
  });

  it("fails closed for an invalid branch ref", () => {
    const result = exportAutonomousRunPatch(repoDir!, headSha, "not..valid");
    expect(result.ok).toBe(false);
  });

  it("fails closed for a nonexistent branch", () => {
    const result = exportAutonomousRunPatch(repoDir!, headSha, "autonomous/does-not-exist");
    expect(result.ok).toBe(false);
  });

  it("refuses to export a patch from the AIQT product's own repository", () => {
    const result = exportAutonomousRunPatch(repoRoot, headSha, "main");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/self-management/i);
  });

  it("never mutates the source repository -- branch/HEAD are unchanged after export", () => {
    execFileSync("git", ["checkout", "-b", "autonomous/issue-2-run-2", headSha], { cwd: repoDir! });
    execFileSync("git", ["checkout", "main"], { cwd: repoDir! });
    const branchBefore = execFileSync("git", ["branch", "--show-current"], { cwd: repoDir!, encoding: "utf8" }).trim();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir!, encoding: "utf8" }).trim();

    exportAutonomousRunPatch(repoDir!, headSha, "autonomous/issue-2-run-2");

    const branchAfter = execFileSync("git", ["branch", "--show-current"], { cwd: repoDir!, encoding: "utf8" }).trim();
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
  });
});
