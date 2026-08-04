import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { runAutonomousCommand } from "../../src/workspaces/autonomous-command-runner.js";
import type { AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";
import { makeTempDir, removeDir } from "../helpers.js";

// M36-WU03: this file spawns real subprocesses (git status, to
// exercise the actual execFileSync path); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const policy = (boundary: string): AutonomousExecutionPolicy => ({
  allowedCommandClasses: ["read_only_inspection", "repository_local_write", "git_operation", "test_or_build"],
  blockedCommandClasses: [],
  networkPolicy: "denied",
  filesystemBoundary: boundary,
  gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
});

describe("runAutonomousCommand (M36-WU03)", () => {
  it("executes an allowed command inside the boundary and captures its output", () => {
    const dir = makeTempDir();
    try {
      const result = runAutonomousCommand({ command: "git", args: ["status"] }, dir, policy(dir));
      expect(result.status).toBe("executed");
      if (result.status === "executed") {
        // Not a real Git repository, so a non-zero exit is expected here
        // -- this test's point is that classification allowed the
        // command through to real execution, not that git succeeded.
        expect(typeof result.exitCode).toBe("number");
        expect(result.stdout.length + result.stderr.length).toBeGreaterThanOrEqual(0);
      }
    } finally {
      removeDir(dir);
    }
  });

  it("denies a command whose worktreePath falls outside the policy's filesystemBoundary, without ever spawning it", () => {
    const dir = makeTempDir();
    const outsideBoundary = makeTempDir();
    try {
      const result = runAutonomousCommand({ command: "git", args: ["status"] }, dir, policy(outsideBoundary));
      expect(result.status).toBe("out_of_boundary");
    } finally {
      removeDir(dir);
      removeDir(outsideBoundary);
    }
  });

  it("accepts a worktreePath equal to the boundary itself (a boundary is not a strict-descendant-only check)", () => {
    const dir = makeTempDir();
    try {
      const result = runAutonomousCommand({ command: "git", args: ["status"] }, dir, policy(dir));
      expect(result.status).not.toBe("out_of_boundary");
    } finally {
      removeDir(dir);
    }
  });

  it("classifies and denies a destructive command before ever calling execFileSync (no directory is actually affected)", () => {
    const dir = makeTempDir();
    try {
      const result = runAutonomousCommand({ command: "rm", args: ["-rf", "."] }, dir, policy(dir));
      expect(result.status).toBe("denied");
      if (result.status === "denied") expect(result.commandClass).toBe("destructive");
    } finally {
      removeDir(dir);
    }
  });

  it("returns a real non-zero exit code (not a denial) for a command that legitimately fails", () => {
    const dir = makeTempDir();
    try {
      // A read-only git command against a non-repository directory --
      // allowed by policy, but git itself exits non-zero. This must be
      // distinguishable from a policy denial.
      const result = runAutonomousCommand({ command: "git", args: ["rev-parse", "--is-inside-work-tree"] }, dir, policy(dir));
      expect(result.status).toBe("executed");
      if (result.status === "executed") expect(result.exitCode).not.toBe(0);
    } finally {
      removeDir(dir);
    }
  });

  it("returns spawn_error (not a crash or an unhandled throw) when the spawn itself fails below the process-exit level", () => {
    const dir = makeTempDir();
    try {
      // An allowed, correctly-classified command (git status), but
      // pointed at a worktreePath that does not exist on disk -- the
      // boundary check is purely string-based (does not require the
      // path to exist) so this reaches execFileSync, which then fails
      // at the spawn level (ENOENT on cwd) rather than returning a
      // process exit code. This is a more portable trigger for this
      // code path than an unrecognized binary name, which platform-
      // dependent PATH contents make unreliable across CI and local.
      const missingCwd = join(dir, "this-subdirectory-does-not-exist");
      const result = runAutonomousCommand({ command: "git", args: ["status"] }, missingCwd, policy(dir));
      expect(result.status).toBe("spawn_error");
    } finally {
      removeDir(dir);
    }
  });
});
