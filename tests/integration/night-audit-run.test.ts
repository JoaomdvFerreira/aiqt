import { describe, it, expect, afterAll, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { runReviewNightRun, runReviewNightSubmit, runReviewNightStatus, runReviewNightCancel, runReviewNightCoverage } from "../../src/cli/commands/night-audit.command.js";
import { computeReviewTaskId } from "../../src/workflow/night-audit-coverage-queue.js";
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import type { ReviewTask } from "../../src/schema/night-audit.schema.js";

// M34-WU02 policy: real `git` subprocess fixture (initGitFixtureRepo).
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}

function readRunlogEvents(dir: string): { type: string; data: Record<string, unknown> }[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

/**
 * M48-WU05/WU06: `aiqt review night run|submit|status|cancel|coverage`
 * against a real disposable Git fixture repository -- never against this
 * repository's own state. No GITHUB_TOKEN is set anywhere in this suite,
 * so every publication attempt takes the "no_credentials" path rather than
 * ever making a real network call.
 */
describe("aiqt review night", () => {
  const tempDirs: string[] = [];
  function freshGitDir(): string {
    const d = makeTempDir();
    tempDirs.push(d);
    initGitFixtureRepo(d);
    return d;
  }
  afterAll(() => {
    for (const d of tempDirs) removeDir(d);
  });

  function submissionFile(taskId: string, overrides: Partial<Record<string, unknown>> = {}): string {
    const submissionsDir = makeTempDir("aiqt-night-audit-submission-");
    tempDirs.push(submissionsDir);
    const path = join(submissionsDir, "submission.json");
    const body = {
      taskId,
      findings: [
        {
          checkId: "check-1",
          title: "Undocumented setup step",
          explanation: "The README does not explain how to run tests.",
          affectedPaths: ["README.md"],
          evidence: [{ evidenceId: "ev-1", description: "No test instructions found.", locator: "README.md:1" }],
          confidence: "strong_signal",
          significance: "medium",
          disposition: "actionable",
          recommendedNextAction: "Add a 'Running tests' section.",
          ...overrides,
        },
      ],
    };
    writeFileSync(path, JSON.stringify(body, null, 2));
    return path;
  }

  it("run starts a fresh session and returns a bounded ReviewTask", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));

    const result = runReviewNightRun(contextFor(dir), {});
    expect(result.status).toBe("passed");
    const data = result.data as { outcome: string; task?: ReviewTask };
    expect(data.outcome).toBe("task");
    expect(data.task).toBeDefined();
    expect(data.task!.scope.length).toBeGreaterThan(0);

    const state = readState(dir);
    expect(state.nightAuditActiveSession).toBeTruthy();
  });

  it("run is idempotent when called again without submitting -- returns the same task", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));

    const first = runReviewNightRun(contextFor(dir), {});
    const second = runReviewNightRun(contextFor(dir), {});
    const firstTask = (first.data as { task: ReviewTask }).task;
    const secondTask = (second.data as { task: ReviewTask }).task;
    expect(secondTask.taskId).toBe(firstTask.taskId);
  });

  it("submit accepts a valid finding, creates a candidate defect, and updates the coverage ledger", async () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));

    const runResult = runReviewNightRun(contextFor(dir), {});
    const task = (runResult.data as { task: ReviewTask }).task;
    const file = submissionFile(task.taskId);

    const submitResult = await runReviewNightSubmit(contextFor(dir), task.taskId, {
      domain: task.domain,
      scope: task.scope,
      commit: task.repositoryCommit,
      fromFile: file,
    });

    expect(submitResult.status).toBe("passed");
    const data = submitResult.data as { outcome: { acceptedCount: number; rejectedCount: number; results: { publication?: { kind: string } }[] } };
    expect(data.outcome.acceptedCount).toBe(1);
    expect(data.outcome.rejectedCount).toBe(0);
    expect(data.outcome.results[0]?.publication?.kind).toBe("no_credentials");

    const state = readState(dir);
    expect(state.defects).toHaveLength(1);
    expect(state.defects[0].sourceKind).toBe("review_finding");
    expect(state.defects[0].status).toBe("candidate");
    expect(state.nightAuditCoverage).toHaveLength(1);
    expect(state.nightAuditCoverage[0].domain).toBe(task.domain);
    expect(state.nightAuditCoverage[0].findingsProduced).toBe(true);

    // Zero repository mutation: only .aiqt/ files changed.
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    for (const line of status.split("\n").filter((l: string) => l.trim().length > 0)) {
      expect(line).toMatch(/\.aiqt\//);
    }
  });

  it("submit rejects a low-confidence finding without creating a defect", async () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const runResult = runReviewNightRun(contextFor(dir), {});
    const task = (runResult.data as { task: ReviewTask }).task;
    const file = submissionFile(task.taskId, { confidence: "weak_signal" });

    const submitResult = await runReviewNightSubmit(contextFor(dir), task.taskId, { domain: task.domain, scope: task.scope, commit: task.repositoryCommit, fromFile: file });
    const data = submitResult.data as { outcome: { acceptedCount: number; rejectedCount: number } };
    expect(data.outcome.acceptedCount).toBe(0);
    expect(data.outcome.rejectedCount).toBe(1);
    expect(readState(dir).defects ?? []).toHaveLength(0);
  });

  it("submitting the identical finding twice for the same task enriches the same defect rather than duplicating it", async () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const task = (runReviewNightRun(contextFor(dir), {}).data as { task: ReviewTask }).task;

    await runReviewNightSubmit(contextFor(dir), task.taskId, { domain: task.domain, scope: task.scope, commit: task.repositoryCommit, fromFile: submissionFile(task.taskId) });
    await runReviewNightSubmit(contextFor(dir), task.taskId, { domain: task.domain, scope: task.scope, commit: task.repositoryCommit, fromFile: submissionFile(task.taskId) });

    expect(readState(dir).defects).toHaveLength(1);
  });

  it("rejects a submission whose --domain/--scope/--commit do not match the taskId", async () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const badTaskId = computeReviewTaskId("tests", "wrong-scope", "a".repeat(40));
    const result = await runReviewNightSubmit(contextFor(dir), badTaskId, { domain: "tests", scope: "different-scope", commit: "a".repeat(40), fromFile: submissionFile(badTaskId) });
    expect(result.status).toBe("failed");
  });

  it("status reports no session, then the active session, then the finished result after budget exhaustion", async () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));

    const none = runReviewNightStatus(contextFor(dir), {});
    expect((none.data as { status: { kind: string } }).status.kind).toBe("none");

    const task = (runReviewNightRun(contextFor(dir), { maxReviewTasks: 1 }).data as { task: ReviewTask }).task;
    const active = runReviewNightStatus(contextFor(dir), {});
    expect((active.data as { status: { kind: string } }).status.kind).toBe("active");

    await runReviewNightSubmit(contextFor(dir), task.taskId, { domain: task.domain, scope: task.scope, commit: task.repositoryCommit, fromFile: submissionFile(task.taskId) });

    const stopped = runReviewNightRun(contextFor(dir), {});
    expect((stopped.data as { outcome: string }).outcome).toBe("stopped");
    expect((stopped.data as { result: { stopReason: string } }).result.stopReason).toBe("budget_exhausted");

    const last = runReviewNightStatus(contextFor(dir), {});
    expect((last.data as { status: { kind: string } }).status.kind).toBe("last_result");
    expect(readState(dir).nightAuditActiveSession).toBeNull();
  });

  it("cancel clears an active session and reports cancelled", () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runReviewNightRun(contextFor(dir), {});

    const cancelled = runReviewNightCancel(contextFor(dir), {});
    expect(cancelled.status).toBe("passed");
    expect(readState(dir).nightAuditActiveSession).toBeNull();

    const again = runReviewNightCancel(contextFor(dir), {});
    expect(again.status).toBe("blocked");
  });

  it("coverage lists ledger entries after at least one submission", async () => {
    const dir = freshGitDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const task = (runReviewNightRun(contextFor(dir), {}).data as { task: ReviewTask }).task;
    await runReviewNightSubmit(contextFor(dir), task.taskId, { domain: task.domain, scope: task.scope, commit: task.repositoryCommit, fromFile: submissionFile(task.taskId) });

    const coverage = runReviewNightCoverage(contextFor(dir), {});
    expect((coverage.data as { coverage: unknown[] }).coverage).toHaveLength(1);
  });

  it("fails clearly when no AIQT project exists at the target", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const result = runReviewNightRun(contextFor(dir), {});
    expect(result.status).toBe("failed");
  });

  describe("M48 closure correction: provider-independent per-ReviewTask telemetry", () => {
    it("run stamps currentTaskAssignedAt only when a task is actually assigned", () => {
      const dir = freshGitDir();
      runInit(contextFor(dir), normalizeInitOptions({}));

      expect(readState(dir).nightAuditActiveSession).toBeUndefined();
      runReviewNightRun(contextFor(dir), {});
      const assignedAt = readState(dir).nightAuditActiveSession.currentTaskAssignedAt;
      expect(typeof assignedAt).toBe("string");
      expect(Number.isNaN(Date.parse(assignedAt))).toBe(false);
    });

    it("a repeated run with no intervening submit never resets the assignment timestamp", () => {
      const dir = freshGitDir();
      runInit(contextFor(dir), normalizeInitOptions({}));

      runReviewNightRun(contextFor(dir), {});
      const first = readState(dir).nightAuditActiveSession.currentTaskAssignedAt;
      runReviewNightRun(contextFor(dir), {});
      const second = readState(dir).nightAuditActiveSession.currentTaskAssignedAt;
      expect(second).toBe(first);
    });

    it("accepted finding event carries scope, contextItemCount, executionProfile, and an honest per-task duration", async () => {
      const dir = freshGitDir();
      runInit(contextFor(dir), normalizeInitOptions({}));
      const task = (runReviewNightRun(contextFor(dir), {}).data as { task: ReviewTask }).task;

      await runReviewNightSubmit(contextFor(dir), task.taskId, { domain: task.domain, scope: task.scope, commit: task.repositoryCommit, fromFile: submissionFile(task.taskId) });

      const events = readRunlogEvents(dir);
      const accepted = events.find((e) => e.type === "night_audit.finding_accepted");
      expect(accepted).toBeDefined();
      expect(accepted!.data.domain).toBe(task.domain);
      expect(accepted!.data.scope).toBe(task.scope);
      expect(typeof accepted!.data.contextItemCount).toBe("number");
      expect(accepted!.data.contextItemCount as number).toBeGreaterThanOrEqual(0);
      expect(accepted!.data.executionProfile).toEqual({ agentClass: "balanced", reasoningEffort: "high" });
      expect(typeof accepted!.data.taskDurationMs).toBe("number");
      expect(accepted!.data.taskDurationMs as number).toBeGreaterThanOrEqual(0);

      // Resolved: submit clears the assignment so the next task gets its own fresh timestamp.
      expect(readState(dir).nightAuditActiveSession.currentTaskAssignedAt).toBeUndefined();
    });

    it("rejected finding event carries the same execution metadata", async () => {
      const dir = freshGitDir();
      runInit(contextFor(dir), normalizeInitOptions({}));
      const task = (runReviewNightRun(contextFor(dir), {}).data as { task: ReviewTask }).task;

      await runReviewNightSubmit(contextFor(dir), task.taskId, {
        domain: task.domain,
        scope: task.scope,
        commit: task.repositoryCommit,
        fromFile: submissionFile(task.taskId, { confidence: "weak_signal" }),
      });

      const events = readRunlogEvents(dir);
      const rejected = events.find((e) => e.type === "night_audit.finding_rejected");
      expect(rejected).toBeDefined();
      expect(rejected!.data.scope).toBe(task.scope);
      expect(typeof rejected!.data.contextItemCount).toBe("number");
      expect(rejected!.data.executionProfile).toEqual({ agentClass: "balanced", reasoningEffort: "high" });
      expect(typeof rejected!.data.taskDurationMs).toBe("number");
    });

    it("never invents provider/model identity or token usage when unavailable", async () => {
      const dir = freshGitDir();
      runInit(contextFor(dir), normalizeInitOptions({}));
      const task = (runReviewNightRun(contextFor(dir), {}).data as { task: ReviewTask }).task;
      await runReviewNightSubmit(contextFor(dir), task.taskId, { domain: task.domain, scope: task.scope, commit: task.repositoryCommit, fromFile: submissionFile(task.taskId) });

      const events = readRunlogEvents(dir);
      const accepted = events.find((e) => e.type === "night_audit.finding_accepted")!;
      for (const key of ["providerId", "modelId", "provider", "model", "tokenUsage", "tokensUsed", "tokenCount"]) {
        expect(accepted.data).not.toHaveProperty(key);
      }
    });

    it("a session backdated past hardStopMinutes + grace is reconciled to interrupted, and the fresh session starts with no stale assignment", () => {
      const dir = freshGitDir();
      runInit(contextFor(dir), normalizeInitOptions({}));
      runReviewNightRun(contextFor(dir), { targetDurationMinutes: 30, hardStopMinutes: 60 });

      const state = readState(dir);
      const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago, past 60min hardStop + 60min grace
      state.nightAuditActiveSession.startedAt = old;
      writeState(dir, state);

      const result = runReviewNightRun(contextFor(dir), { targetDurationMinutes: 30, hardStopMinutes: 60 });
      const data = result.data as { outcome: string; task?: ReviewTask };
      expect(data.outcome).toBe("task");

      const events = readRunlogEvents(dir);
      expect(events.some((e) => e.type === "night_audit.session_interrupted")).toBe(true);

      // The freshly started session's own pending-assignment timestamp is set for its own task, never inherited from the interrupted one.
      const freshSession = readState(dir).nightAuditActiveSession;
      expect(freshSession.startedAt).not.toBe(old);
      expect(typeof freshSession.currentTaskAssignedAt).toBe("string");
    });
  });
});
