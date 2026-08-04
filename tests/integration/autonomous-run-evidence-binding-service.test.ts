import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { produceAutonomousEvidencePacket } from "../../src/services/autonomous-run-evidence-binding-service.js";
import { DeterministicStubAgentAdapter } from "../../src/workflow/autonomous-run-agent-adapter.js";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousExecutionPolicy, AutonomousSafetyAssessment } from "../../src/schema/autonomous-run.schema.js";

// M36-WU04: this file spawns real subprocesses (git, via the real
// worktree lifecycle, command runner, and diff/validation services); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

function candidate(overrides: Partial<AutonomousCandidate> = {}): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "issue",
    repository: "example/repo",
    baseRef: "HEAD",
    objective: "Make a safe, in-budget repair",
    acceptanceCriteria: ["targeted validation passes"],
    constraints: [],
    requestedPermissions: [],
    ...overrides,
  };
}

function safetyAssessment(): AutonomousSafetyAssessment {
  return {
    riskClass: "low_risk_autonomous",
    prohibitedAreas: [],
    requiredApprovals: [],
    commandPolicyProfile: "default",
    networkPolicy: "denied",
    reason: "No prohibited areas detected.",
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
 * M36-WU04 (build spec Sec 7 WU36-04 acceptance criteria: "packet follows
 * the M33 machine contract," "no pass without validation," "unexpected
 * changes block the run," "review findings are surfaced," "evidence is
 * bound to commit and diff," "no merge or deployment occurs"). Real
 * disposable Git repository, exercising the full
 * execution -> diff -> validation -> self-review -> packet pipeline.
 */
describe("produceAutonomousEvidencePacket (M36-WU04, real disposable repository)", () => {
  let repoDir: string | null = null;
  let workspaceRoot: string | null = null;
  let headSha = "";
  let runCounter = 0;

  beforeEach(() => {
    repoDir = makeTempDir("aiqt-evidence-repo-");
    headSha = initGitFixtureRepo(repoDir);
    workspaceRoot = makeTempDir("aiqt-evidence-ws-root-");
    runCounter += 1;
  });

  afterEach(() => {
    if (repoDir) removeDir(repoDir);
    if (workspaceRoot) removeDir(workspaceRoot);
  });

  function runId(): string {
    return `run-${runCounter}-${Date.now()}`;
  }

  function baseParams(overrides: Record<string, unknown> = {}) {
    return {
      runId: runId(),
      candidate: candidate(),
      safetyAssessment: safetyAssessment(),
      sourceRepositoryPath: repoDir!,
      baseCommit: headSha,
      workspaceRoot: workspaceRoot!,
      policy: standardPolicy(workspaceRoot!),
      budgets: generousBudgets,
      agentAdapter: new DeterministicStubAgentAdapter([]),
      targetedValidationCommands: [] as { command: string; args: string[] }[],
      authoritativeValidationCommands: [] as { command: string; args: string[] }[],
      ...overrides,
    };
  }

  it("resultState:passed when the repair changes a file, targeted validation passes, and no findings are raised", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["mv", "README.md", "README2.md"] }]),
        targetedValidationCommands: [{ command: "git", args: ["status"] }],
      }),
    );
    expect(packet.resultState).toBe("passed");
    expect(packet.recommendedHumanAction).toBe("review_and_merge");
    expect(packet.validation?.targetedTestsPassed).toBe(true);
    expect(packet.diffSummary?.changedFiles).toBe(1);
    expect(packet.filesChanged.length).toBeGreaterThan(0);
    expect(packet.workspace?.cleanupStatus).toBe("cleaned");
  });

  it("resultState:validation_failed when no targeted validation commands are ever supplied (no pass without validation)", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["status"] }]),
        targetedValidationCommands: [],
      }),
    );
    expect(packet.resultState).toBe("validation_failed");
    expect(packet.recommendedHumanAction).toBe("request_changes");
  });

  it("resultState:review_rejected when validation passes but the run renamed a tracked file into a lockfile name (unexpected file, threat model Sec 3.20)", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["mv", "README.md", "pnpm-lock.yaml"] }]),
        targetedValidationCommands: [{ command: "git", args: ["status"] }],
      }),
    );
    expect(packet.resultState).toBe("review_rejected");
    expect(packet.diffSummary?.unexpectedFiles).toEqual(["pnpm-lock.yaml"]);
    expect(packet.findings.some((f) => f.includes("pnpm-lock.yaml"))).toBe(true);
  });

  it("resultState:review_rejected when targeted validation passes but the repair produced no diff at all", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([
          { command: "git", args: ["commit", "--allow-empty", "-m", "noop"] },
        ]),
        targetedValidationCommands: [{ command: "git", args: ["status"] }],
      }),
    );
    expect(packet.resultState).toBe("review_rejected");
    expect(packet.findings.some((f) => /no files were changed/i.test(f))).toBe(true);
  });

  it("resultState:blocked (with recommendedHumanAction:discard) when a proposed command is denied by policy", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "rm", args: ["-rf", "."] }]),
      }),
    );
    expect(packet.resultState).toBe("blocked");
    expect(packet.recommendedHumanAction).toBe("discard");
    expect(packet.workspace?.cleanupStatus).toBe("cleaned");
  });

  it("resultState:budget_exhausted (with recommendedHumanAction:rerun_with_modified_budget) when the command-count budget is hit", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        budgets: { ...generousBudgets, maxCommandCount: 1 },
        agentAdapter: new DeterministicStubAgentAdapter([
          { command: "git", args: ["status"] },
          { command: "git", args: ["log", "-1"] },
        ]),
      }),
    );
    expect(packet.resultState).toBe("budget_exhausted");
    expect(packet.recommendedHumanAction).toBe("rerun_with_modified_budget");
  });

  it("resultState:cancelled when the cancellation signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["status"] }]),
        cancellationSignal: controller.signal,
      }),
    );
    expect(packet.resultState).toBe("cancelled");
    expect(packet.recommendedHumanAction).toBe("discard");
  });

  it("resultState:failed (recommendedHumanAction:provide_missing_input) when the workspace could not be prepared", () => {
    const invalidRoot = join(repoDir!, "nested-inside-repo");
    mkdirSync(invalidRoot, { recursive: true });
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        workspaceRoot: invalidRoot,
        policy: standardPolicy(invalidRoot),
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["status"] }]),
      }),
    );
    expect(packet.resultState).toBe("failed");
    expect(packet.recommendedHumanAction).toBe("provide_missing_input");
    expect(packet.workspace).toBeUndefined();
  });

  it("never modifies the source repository's default branch or HEAD", () => {
    const branchBefore = execFileSync("git", ["branch", "--show-current"], { cwd: repoDir!, encoding: "utf8" }).trim();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir!, encoding: "utf8" }).trim();

    produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["mv", "README.md", "README2.md"] }]),
        targetedValidationCommands: [{ command: "git", args: ["status"] }],
      }),
    );

    const branchAfter = execFileSync("git", ["branch", "--show-current"], { cwd: repoDir!, encoding: "utf8" }).trim();
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
  });

  it("removes the worktree exactly once regardless of outcome (no leftover worktree listing)", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "rm", args: ["-rf", "."] }]),
      }),
    );
    const worktreeListing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoDir!, encoding: "utf8" });
    expect(worktreeListing).not.toContain(packet.workspace!.worktreePath.replace(/\\/g, "/"));
  });

  it("no function in this module or its call graph merges a branch (structural check, comments excluded)", async () => {
    const fs = await import("node:fs");
    const { dirname, join: pathJoin } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = pathJoin(here, "..", "..");
    const files = [
      "src/services/autonomous-run-evidence-binding-service.ts",
      "src/services/autonomous-run-validation-service.ts",
      "src/workflow/autonomous-run-diff-summary.ts",
      "src/workflow/autonomous-run-self-review.ts",
      "src/services/autonomous-run-command-result.ts",
    ];
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of files) {
      const text = codeOnly(fs.readFileSync(pathJoin(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a git merge or a merge-capable function`).not.toMatch(/["'`]merge["'`]|\.merge\(|gitMerge/i);
    }
  });
});
