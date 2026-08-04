import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { runAutonomousValidation } from "../../src/services/autonomous-run-validation-service.js";
import type { AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";

// M36-WU04: this file spawns real subprocesses (git, via
// runAutonomousValidation -> runAutonomousCommand); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const policy = (boundary: string): AutonomousExecutionPolicy => ({
  allowedCommandClasses: ["read_only_inspection", "repository_local_write", "git_operation", "test_or_build"],
  blockedCommandClasses: [],
  networkPolicy: "denied",
  filesystemBoundary: boundary,
  gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
});

/**
 * M36-WU04 (build spec Sec 7 WU36-04 acceptance criterion: "no pass
 * without validation"). Real disposable Git repository.
 */
describe("runAutonomousValidation (M36-WU04, real disposable repository)", () => {
  let repoDir: string | null = null;

  beforeEach(() => {
    repoDir = makeTempDir("aiqt-validation-repo-");
    initGitFixtureRepo(repoDir);
  });

  afterEach(() => {
    if (repoDir) removeDir(repoDir);
  });

  it("reports targetedTestsPassed:false when no targeted commands are supplied -- never vacuously passed", () => {
    const result = runAutonomousValidation({
      worktreePath: repoDir!,
      policy: policy(repoDir!),
      targetedCommands: [],
      authoritativeCommands: [],
      maxValidationSeconds: 30,
    });
    expect(result.targetedTestsPassed).toBe(false);
    expect(result.authoritativeValidationPassed).toBeNull();
  });

  it("reports targetedTestsPassed:true when every targeted command exits zero", () => {
    const result = runAutonomousValidation({
      worktreePath: repoDir!,
      policy: policy(repoDir!),
      targetedCommands: [{ command: "git", args: ["status"] }],
      authoritativeCommands: [],
      maxValidationSeconds: 30,
    });
    expect(result.targetedTestsPassed).toBe(true);
    expect(result.commandsExecuted).toEqual(["git status"]);
  });

  it("reports targetedTestsPassed:false when a targeted command exits non-zero, without a blockedReason (a real failure, not a policy block)", () => {
    const result = runAutonomousValidation({
      worktreePath: repoDir!,
      policy: policy(repoDir!),
      targetedCommands: [{ command: "git", args: ["rev-parse", "refs/does-not-exist"] }],
      authoritativeCommands: [],
      maxValidationSeconds: 30,
    });
    expect(result.targetedTestsPassed).toBe(false);
    expect(result.blockedReason).toBeNull();
  });

  it("sets blockedReason and stops when a targeted command is denied by policy", () => {
    const result = runAutonomousValidation({
      worktreePath: repoDir!,
      policy: policy(repoDir!),
      targetedCommands: [{ command: "rm", args: ["-rf", "."] }],
      authoritativeCommands: [],
      maxValidationSeconds: 30,
    });
    expect(result.targetedTestsPassed).toBe(false);
    expect(result.blockedReason).toMatch(/destructive/i);
  });

  it("never runs authoritative commands when targeted validation did not pass", () => {
    const result = runAutonomousValidation({
      worktreePath: repoDir!,
      policy: policy(repoDir!),
      targetedCommands: [{ command: "git", args: ["rev-parse", "refs/does-not-exist"] }],
      authoritativeCommands: [{ command: "git", args: ["status"] }],
      maxValidationSeconds: 30,
    });
    expect(result.authoritativeValidationPassed).toBeNull();
    // The failing targeted command itself is recorded as executed (it did
    // reach execFileSync, it just exited non-zero) -- only the
    // authoritative command list, which must never run once targeted
    // validation fails, is absent from this list.
    expect(result.commandsExecuted).toEqual(["git rev-parse refs/does-not-exist"]);
  });

  it("runs authoritative commands and reports their pass/fail once targeted validation passes", () => {
    const result = runAutonomousValidation({
      worktreePath: repoDir!,
      policy: policy(repoDir!),
      targetedCommands: [{ command: "git", args: ["status"] }],
      authoritativeCommands: [{ command: "git", args: ["log", "-1"] }],
      maxValidationSeconds: 30,
    });
    expect(result.targetedTestsPassed).toBe(true);
    expect(result.authoritativeValidationPassed).toBe(true);
    expect(result.commandsExecuted).toEqual(["git status", "git log -1"]);
  });
});
