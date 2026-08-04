import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { captureAutonomousDiffSummary, listAutonomousChangedFilePaths } from "../../src/workflow/autonomous-run-diff-summary.js";

// M36-WU04: this file spawns real subprocesses (git, via
// gitDiffNumstat/gitLsFilesOthersExcludeStandard). See
// docs/engineering/m34-validation-workload-policy.md Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M36-WU04 (build spec Sec 7 WU36-04 Scope: "diff limits; changed-file
 * checks"; threat model Sec 3.20). Real disposable Git repository, not
 * mocked git output.
 */
describe("captureAutonomousDiffSummary / listAutonomousChangedFilePaths (M36-WU04, real disposable repository)", () => {
  let repoDir: string | null = null;
  let headSha = "";

  beforeEach(() => {
    repoDir = makeTempDir("aiqt-diffsum-repo-");
    headSha = initGitFixtureRepo(repoDir);
  });

  afterEach(() => {
    if (repoDir) removeDir(repoDir);
  });

  it("reports zero changes for a clean tree relative to HEAD", () => {
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary).toEqual({ changedFiles: 0, insertedLines: 0, deletedLines: 0, unexpectedFiles: [] });
    expect(listAutonomousChangedFilePaths(repoDir!, headSha)).toEqual([]);
  });

  it("counts a modified tracked file's inserted/deleted lines and lists its path", () => {
    writeFileSync(join(repoDir!, "README.md"), "hello\nagain\nand again\n");
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary.changedFiles).toBe(1);
    expect(summary.insertedLines).toBeGreaterThan(0);
    expect(listAutonomousChangedFilePaths(repoDir!, headSha)).toEqual(["README.md"]);
  });

  it("counts a new untracked file as a changed file with no line counts (numstat only covers tracked files)", () => {
    writeFileSync(join(repoDir!, "new-file.txt"), "content\n");
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary.changedFiles).toBe(1);
    expect(summary.insertedLines).toBe(0);
    expect(listAutonomousChangedFilePaths(repoDir!, headSha)).toEqual(["new-file.txt"]);
  });

  it("flags a changed pnpm-lock.yaml as unexpected regardless of declared scope", () => {
    writeFileSync(join(repoDir!, "pnpm-lock.yaml"), "lockfile: true\n");
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary.unexpectedFiles).toEqual(["pnpm-lock.yaml"]);
  });

  it("flags a rename INTO a lockfile name as unexpected, resolving the destination path out of git's \"old => new\" numstat format", () => {
    execFileSync("git", ["mv", "README.md", "pnpm-lock.yaml"], { cwd: repoDir! });
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary.unexpectedFiles).toEqual(["pnpm-lock.yaml"]);
    expect(listAutonomousChangedFilePaths(repoDir!, headSha)).toEqual(["pnpm-lock.yaml"]);
  });

  it("flags a changed package-lock.json as unexpected", () => {
    writeFileSync(join(repoDir!, "package-lock.json"), "{}\n");
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary.unexpectedFiles).toEqual(["package-lock.json"]);
  });

  it("does not flag an ordinary source file as unexpected", () => {
    writeFileSync(join(repoDir!, "ordinary.ts"), "export const x = 1;\n");
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary.unexpectedFiles).toEqual([]);
  });

  it("counts a binary file change without throwing (numstat reports \"-\\t-\\tpath\" for binaries)", () => {
    writeFileSync(join(repoDir!, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    execFileSync("git", ["add", "binary.bin"], { cwd: repoDir! });
    execFileSync("git", ["commit", "--quiet", "-m", "add binary"], { cwd: repoDir! });
    writeFileSync(join(repoDir!, "binary.bin"), Buffer.from([4, 5, 6, 7, 0, 254]));
    const summary = captureAutonomousDiffSummary(repoDir!, headSha);
    expect(summary.changedFiles).toBe(1);
    expect(summary.insertedLines).toBe(0);
    expect(summary.deletedLines).toBe(0);
  });
});
