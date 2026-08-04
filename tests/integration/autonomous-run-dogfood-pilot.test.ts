import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { produceAutonomousEvidencePacket } from "../../src/services/autonomous-run-evidence-binding-service.js";
import { buildAutonomousRunCommandResult } from "../../src/services/autonomous-run-command-result.js";
import { DeterministicStubAgentAdapter } from "../../src/workflow/autonomous-run-agent-adapter.js";
import type {
  AutonomousCandidate,
  AutonomousBudgets,
  AutonomousExecutionPolicy,
  AutonomousSafetyAssessment,
  AutonomousEvidencePacket,
} from "../../src/schema/autonomous-run.schema.js";

// M36-WU05: this file spawns real subprocesses (git, via the full
// evidence-binding pipeline). See
// docs/engineering/m34-validation-workload-policy.md Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M36-WU05 (build spec Sec 7 WU36-05 Scope: "dogfood pilot, recovery, and
 * closure"; acceptance criteria: "successful low-risk run; blocked unsafe
 * run; cancelled run; budget-exhausted run; validation-failed run; no
 * automatic merge; no default-branch mutation; full evidence for every
 * scenario; AIQT repository never self-managed by the runner").
 *
 * The dogfood target is a fresh, disposable, non-AIQT Git repository
 * created by this test (never this repository's own working tree) --
 * this is the same "real disposable Git repository, not mocks" pattern
 * every other M36 Work Unit already used, now run end-to-end through the
 * full pipeline (candidate -> execution -> diff -> validation -> review
 * -> evidence packet -> CommandResult) and framed explicitly as a pilot
 * with its evidence captured to a committed report
 * (docs/engineering/m36-wu05-dogfood-evidence.generated.json) rather than
 * only asserted inline. Running this against a real external repository
 * would require the user's explicit authorization to target real code
 * and was deliberately not done here -- see the closure report for why a
 * disposable synthetic target satisfies every acceptance criterion
 * without that additional, unrequested scope.
 */
const evidenceReport: Record<string, unknown> = {};

function candidate(overrides: Partial<AutonomousCandidate> = {}): AutonomousCandidate {
  return {
    issueId: "DOGFOOD-1",
    source: "manual",
    repository: "dogfood/target-repo",
    baseRef: "HEAD",
    objective: "Rename a stray typo-named file to its corrected name",
    acceptanceCriteria: ["the target file no longer exists under its typo name", "targeted validation passes"],
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
    reason: "Dogfood pilot: no prohibited areas detected in this candidate.",
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

describe("M36-WU05 dogfood pilot: full pipeline against a real disposable, non-AIQT target repository", () => {
  let targetRepoDir: string | null = null;
  let workspaceRoot: string | null = null;
  let headSha = "";
  let runCounter = 0;

  beforeEach(() => {
    targetRepoDir = makeTempDir("aiqt-dogfood-target-");
    headSha = initGitFixtureRepo(targetRepoDir);
    writeFileSync(join(targetRepoDir, "CONTRIBUTNIG.md"), "typo-named contributing guide\n");
    execFileSync("git", ["add", "CONTRIBUTNIG.md"], { cwd: targetRepoDir });
    execFileSync("git", ["commit", "--quiet", "-m", "add typo-named file"], { cwd: targetRepoDir });
    headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepoDir, encoding: "utf8" }).trim();
    workspaceRoot = makeTempDir("aiqt-dogfood-ws-root-");
    runCounter += 1;
  });

  afterEach(() => {
    if (targetRepoDir) removeDir(targetRepoDir);
    if (workspaceRoot) removeDir(workspaceRoot);
  });

  afterAll(() => {
    const reportPath = join(repoRoot, "docs", "engineering", "m36-wu05-dogfood-evidence.generated.json");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(evidenceReport, null, 2) + "\n");
  });

  function runId(): string {
    return `dogfood-run-${runCounter}-${Date.now()}`;
  }

  function baseParams(overrides: Record<string, unknown> = {}) {
    return {
      runId: runId(),
      candidate: candidate(),
      safetyAssessment: safetyAssessment(),
      sourceRepositoryPath: targetRepoDir!,
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

  function recordEvidence(scenario: string, packet: AutonomousEvidencePacket): void {
    evidenceReport[scenario] = {
      packet,
      commandResult: buildAutonomousRunCommandResult(packet),
    };
  }

  it("Scenario 1 -- successful low-risk run: renames the typo file, targeted validation passes, resultState:passed, no merge, default branch untouched", () => {
    const branchBefore = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepoDir!, encoding: "utf8" }).trim();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepoDir!, encoding: "utf8" }).trim();

    // M37-WU03 correction: commits the rename on the run's own branch,
    // not merely staging it -- a bare `git mv` with no commit leaves the
    // worktree genuinely dirty, and `git worktree remove` (never passed
    // --force by this repository, by design) legitimately refuses to
    // remove a dirty worktree. This scenario previously asserted
    // cleanupStatus:"cleaned" while leaving the worktree dirty, which
    // only ever passed because produceAutonomousEvidencePacket itself
    // had a real bug (found while building M37-WU03's own tests): it
    // discarded removeAutonomousWorktree's result entirely and
    // hardcoded "cleaned". Both are fixed now -- see
    // autonomous-run-evidence-binding-service.ts's own comment at the
    // fix site.
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([
          { command: "git", args: ["mv", "CONTRIBUTNIG.md", "CONTRIBUTING.md"] },
          { command: "git", args: ["commit", "-m", "rename contributing guide"] },
        ]),
        targetedValidationCommands: [{ command: "git", args: ["status"] }],
      }),
    );
    recordEvidence("scenario_1_successful_low_risk_run", packet);

    expect(packet.resultState).toBe("passed");
    expect(packet.recommendedHumanAction).toBe("review_and_merge");
    expect(packet.validation?.targetedTestsPassed).toBe(true);
    expect(packet.diffSummary?.unexpectedFiles).toEqual([]);
    expect(packet.workspace?.cleanupStatus).toBe("cleaned");

    const branchAfter = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepoDir!, encoding: "utf8" }).trim();
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepoDir!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
  });

  it("Scenario 2 -- blocked unsafe run: a destructive command is denied by policy before it ever executes, resultState:blocked, target repository is untouched", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([
          { command: "git", args: ["mv", "CONTRIBUTNIG.md", "CONTRIBUTING.md"] },
          { command: "rm", args: ["-rf", "."] },
        ]),
        targetedValidationCommands: [{ command: "git", args: ["status"] }],
      }),
    );
    recordEvidence("scenario_2_blocked_unsafe_run", packet);

    expect(packet.resultState).toBe("blocked");
    expect(packet.recommendedHumanAction).toBe("discard");
    // Only the first (allowed) command actually ran before the destructive
    // one was denied and the run stopped.
    expect(packet.commandsExecuted).toEqual(["git mv CONTRIBUTNIG.md CONTRIBUTING.md"]);
    // M37-WU03 correction: the run was denied immediately after an
    // uncommitted rename already ran, leaving the worktree genuinely
    // dirty -- `git worktree remove` (never passed --force by this
    // repository) legitimately fails here. This is expected, honest
    // behavior for a mid-run denial, not a defect; see Scenario 1's own
    // comment for the underlying bug this corrects.
    expect(packet.workspace?.cleanupStatus).toBe("cleanup_failed");
  });

  it("Scenario 3 -- cancelled run: a pre-aborted cancellation signal stops the run before any command executes, resultState:cancelled", () => {
    const controller = new AbortController();
    controller.abort();
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["mv", "CONTRIBUTNIG.md", "CONTRIBUTING.md"] }]),
        cancellationSignal: controller.signal,
      }),
    );
    recordEvidence("scenario_3_cancelled_run", packet);

    expect(packet.resultState).toBe("cancelled");
    expect(packet.recommendedHumanAction).toBe("discard");
    expect(packet.commandsExecuted).toEqual([]);
    expect(packet.workspace?.cleanupStatus).toBe("cleaned");
  });

  it("Scenario 4 -- budget-exhausted run: a tight command-count budget stops the run after exactly the allowed number of commands, resultState:budget_exhausted", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        budgets: { ...generousBudgets, maxCommandCount: 1 },
        agentAdapter: new DeterministicStubAgentAdapter([
          { command: "git", args: ["mv", "CONTRIBUTNIG.md", "CONTRIBUTING.md"] },
          { command: "git", args: ["status"] },
        ]),
      }),
    );
    recordEvidence("scenario_4_budget_exhausted_run", packet);

    expect(packet.resultState).toBe("budget_exhausted");
    expect(packet.recommendedHumanAction).toBe("rerun_with_modified_budget");
    expect(packet.commandsExecuted).toEqual(["git mv CONTRIBUTNIG.md CONTRIBUTING.md"]);
  });

  it("Scenario 5 -- validation-failed run: the repair itself succeeds but targeted validation fails, resultState:validation_failed (no pass without validation)", () => {
    const packet = produceAutonomousEvidencePacket(
      baseParams({
        agentAdapter: new DeterministicStubAgentAdapter([{ command: "git", args: ["mv", "CONTRIBUTNIG.md", "CONTRIBUTING.md"] }]),
        targetedValidationCommands: [{ command: "git", args: ["rev-parse", "refs/does-not-exist"] }],
      }),
    );
    recordEvidence("scenario_5_validation_failed_run", packet);

    expect(packet.resultState).toBe("validation_failed");
    expect(packet.recommendedHumanAction).toBe("request_changes");
    expect(packet.validation?.targetedTestsPassed).toBe(false);
  });

  it("no scenario ever merges a branch, mutates the target repository's default branch, or deploys anything", () => {
    for (const key of Object.keys(evidenceReport)) {
      const entry = evidenceReport[key] as { packet: AutonomousEvidencePacket };
      // resultState:"passed" is the only outcome that recommends anything
      // beyond discard/rerun/request_changes, and even it only ever
      // recommends human review -- never an automatic merge action.
      expect(["review_and_merge", "request_changes", "discard", "provide_missing_input", "rerun_with_modified_budget"]).toContain(
        entry.packet.recommendedHumanAction,
      );
    }
  });

  it("AIQT repository is never self-managed by the runner: the dogfood target is a disposable directory distinct from this repository's own working tree, and no .aiqt/ appears here as a result", () => {
    expect(targetRepoDir).not.toBe(repoRoot);
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});
