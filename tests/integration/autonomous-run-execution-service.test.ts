import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { executeAutonomousRun } from "../../src/services/autonomous-run-execution-service.js";
import { DeterministicStubAgentAdapter } from "../../src/workflow/autonomous-run-agent-adapter.js";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";

// M36-WU03: this file spawns real subprocesses (git, via the real
// worktree lifecycle and command runner); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function candidate(overrides: Partial<AutonomousCandidate> = {}): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "issue",
    repository: "example/repo",
    baseRef: "HEAD",
    objective: "Run a safe read-only check",
    acceptanceCriteria: ["git status succeeds"],
    constraints: [],
    requestedPermissions: [],
    ...overrides,
  };
}

const standardPolicy = (boundary: string): AutonomousExecutionPolicy => ({
  allowedCommandClasses: ["read_only_inspection", "repository_local_write", "git_operation", "test_or_build"],
  blockedCommandClasses: [],
  networkPolicy: "denied",
  filesystemBoundary: boundary,
  gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
});

const generousBudgets: AutonomousBudgets = {
  maxWallClockSeconds: 60,
  maxCommandCount: 10,
  maxRetryCount: 3,
  maxChangedFiles: 20,
  maxDiffLines: 500,
  maxValidationSeconds: 60,
};

/**
 * M36-WU03 (build spec Sec 7 WU36-03 acceptance criteria: "default
 * branch is never modified; disallowed commands are blocked; budgets
 * are enforced; cancellation is safe; run evidence is preserved;
 * cleanup is deterministic; no network access occurs unless explicitly
 * permitted"). Exercises executeAutonomousRun end-to-end against a real
 * disposable Git repository -- not mocks.
 */
describe("executeAutonomousRun (M36-WU03, real disposable repository)", () => {
  let repoDir: string | null = null;
  let workspaceRoot: string | null = null;
  let headSha = "";
  let runCounter = 0;

  beforeEach(() => {
    repoDir = makeTempDir("aiqt-exec-repo-");
    headSha = initGitFixtureRepo(repoDir);
    workspaceRoot = makeTempDir("aiqt-exec-ws-root-");
    runCounter += 1;
  });

  afterEach(() => {
    if (repoDir) removeDir(repoDir);
    if (workspaceRoot) removeDir(workspaceRoot);
  });

  function runId(): string {
    return `run-${runCounter}-${Date.now()}`;
  }

  it("completes a run of allowed commands, executing all of them and cleaning up the worktree", () => {
    const adapter = new DeterministicStubAgentAdapter([
      { command: "git", args: ["status"] },
      { command: "git", args: ["log", "-1"] },
    ]);
    const result = executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: generousBudgets,
      agentAdapter: adapter,
    });

    expect(result.outcome).toBe("completed");
    expect(result.commandsExecuted).toEqual(["git status", "git log -1"]);
    expect(result.workspace?.cleanupStatus).toBe("cleaned");
    expect(result.budgetUsage.commandCount).toBe(2);
  });

  it("never modifies the source repository's default branch or HEAD", () => {
    const branchBefore = execFileSync("git", ["branch", "--show-current"], { cwd: repoDir!, encoding: "utf8" }).trim();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir!, encoding: "utf8" }).trim();

    executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: generousBudgets,
      agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["status"] }]),
    });

    const branchAfter = execFileSync("git", ["branch", "--show-current"], { cwd: repoDir!, encoding: "utf8" }).trim();
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
  });

  it("blocks a destructive command before it ever executes, stops the run, and still cleans up", () => {
    const adapter = new DeterministicStubAgentAdapter([
      { command: "git", args: ["status"] },
      { command: "rm", args: ["-rf", "."] },
      { command: "git", args: ["log", "-1"] },
    ]);
    const result = executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: generousBudgets,
      agentAdapter: adapter,
    });

    expect(result.outcome).toBe("denied");
    expect(result.denialReason).toMatch(/destructive/i);
    // Only the first (allowed) command actually ran; the destructive one
    // never reached execFileSync, and the third command was never
    // attempted because the loop stopped.
    expect(result.commandsExecuted).toEqual(["git status"]);
    expect(result.workspace?.cleanupStatus).toBe("cleaned");
  });

  it("denies a network command by default (networkPolicy: denied) without executing it", () => {
    const result = executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: generousBudgets,
      agentAdapter: new DeterministicStubAgentAdapter([{ command: "curl", args: ["https://example.com"] }]),
    });

    expect(result.outcome).toBe("denied");
    expect(result.denialReason).toMatch(/network/i);
    expect(result.commandsExecuted).toEqual([]);
  });

  it("enforces the command-count budget: stops before exceeding it, preserving the commands that already ran", () => {
    const tightBudgets: AutonomousBudgets = { ...generousBudgets, maxCommandCount: 1 };
    const adapter = new DeterministicStubAgentAdapter([
      { command: "git", args: ["status"] },
      { command: "git", args: ["log", "-1"] },
      { command: "git", args: ["branch"] },
    ]);
    const result = executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: tightBudgets,
      agentAdapter: adapter,
    });

    expect(result.outcome).toBe("budget_exhausted");
    expect(result.commandsExecuted).toEqual(["git status"]);
    expect(result.workspace?.cleanupStatus).toBe("cleaned");
  });

  it("cancels safely via a pre-aborted signal: zero commands execute, cleanup still happens", () => {
    const controller = new AbortController();
    controller.abort();
    const result = executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: generousBudgets,
      agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["status"] }]),
      cancellationSignal: controller.signal,
    });

    expect(result.outcome).toBe("cancelled");
    expect(result.commandsExecuted).toEqual([]);
    expect(result.workspace?.cleanupStatus).toBe("cleaned");
  });

  it("cleanup is deterministic: the worktree no longer appears in `git worktree list` after the run, in every outcome", () => {
    const result = executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: generousBudgets,
      agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["status"] }]),
    });

    const worktreeListing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoDir!, encoding: "utf8" });
    expect(worktreeListing).not.toContain(result.workspace!.worktreePath.replace(/\\/g, "/"));
  });

  it("returns workspace_failed and performs no command execution when the workspace root is invalid", () => {
    const invalidRoot = join(repoDir!, "nested-inside-repo"); // strict descendant of the repo, rejected by validateWorkspaceRoot
    mkdirSync(invalidRoot, { recursive: true });
    const result = executeAutonomousRun({
      candidate: candidate(),
      runId: runId(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: invalidRoot,
      policy: standardPolicy(invalidRoot),
      budgets: generousBudgets,
      agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["status"] }]),
    });

    expect(result.outcome).toBe("workspace_failed");
    expect(result.workspace).toBeNull();
    expect(result.commandsExecuted).toEqual([]);
  });

  it("no function in this module or its call graph can merge a branch (structural check: no git-merge invocation or gitMerge-style function anywhere in the actual code, comments excluded)", async () => {
    const fs = await import("node:fs");
    const files = [
      "src/services/autonomous-run-execution-service.ts",
      "src/workspaces/autonomous-worktree-lifecycle.ts",
      "src/workspaces/autonomous-command-runner.ts",
    ];
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of files) {
      const text = codeOnly(fs.readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a git merge or a merge-capable function`).not.toMatch(/["'`]merge["'`]|\.merge\(|gitMerge/i);
    }
  });
});
