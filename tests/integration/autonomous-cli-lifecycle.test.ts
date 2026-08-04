import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { runAutonomousInspect } from "../../src/cli/commands/autonomous-inspect.command.js";
import { runAutonomousClassify } from "../../src/cli/commands/autonomous-classify.command.js";
import { runAutonomousApprove } from "../../src/cli/commands/autonomous-approve.command.js";
import { runAutonomousRun } from "../../src/cli/commands/autonomous-run.command.js";
import { runAutonomousStatus } from "../../src/cli/commands/autonomous-status.command.js";
import { runAutonomousCancel } from "../../src/cli/commands/autonomous-cancel.command.js";
import { runAutonomousResult } from "../../src/cli/commands/autonomous-result.command.js";
import { runAutonomousCleanup } from "../../src/cli/commands/autonomous-cleanup.command.js";
import type { StdinLike } from "../../src/core/filesystem/stdin.js";

// M37-WU01: this file spawns real subprocesses (git, via
// runRepositoryPreflight -> initGitFixtureRepo's fixture setup and every
// autonomous-inspect/classify call). See
// docs/engineering/m34-validation-workload-policy.md Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M37-WU01 (build spec: full CLI acceptance criteria). Exercises the
 * public `aiqt autonomous ...` command handlers directly (the same
 * functions register-commands.ts wires to commander) against a real
 * disposable, non-AIQT target Git repository -- never mocks, never this
 * repository's own working tree.
 */
describe("aiqt autonomous CLI lifecycle (M37-WU01, real disposable target repository)", () => {
  let targetRepo: string | null = null;
  let evidenceDir: string | null = null;
  let configDir: string | null = null;
  let relaxedConfigPath: string | null = null;
  let headSha = "";

  beforeEach(() => {
    targetRepo = makeTempDir("aiqt-cli-target-");
    headSha = initGitFixtureRepo(targetRepo);
    evidenceDir = join(makeTempDir("aiqt-cli-evidence-"), "evidence");
    // Safe defaults (autonomous-run-config-resolution.ts) require
    // approval for EVERY candidate, even low-risk ones, unless the
    // operator explicitly relaxes approvalPolicy to
    // "required_for_elevated" -- most of this suite exercises that safe
    // default deliberately (see "a low-risk candidate still requires
    // approval under the safe default policy" below); this one relaxed
    // config file is used only by the handful of scenarios that need to
    // exercise the no-approval-required path specifically.
    configDir = makeTempDir("aiqt-cli-config-");
    relaxedConfigPath = join(configDir, "relaxed.config.json");
    writeFileSync(relaxedConfigPath, JSON.stringify({ approvalPolicy: "required_for_elevated" }));
  });

  afterEach(() => {
    if (targetRepo) removeDir(targetRepo);
    if (evidenceDir) removeDir(evidenceDir);
    if (configDir) removeDir(configDir);
  });

  const ctx = () => contextFor(process.cwd());

  function classifyLowRiskRequiringApproval() {
    return runAutonomousClassify(ctx(), {
      repository: targetRepo!,
      baseRef: "HEAD",
      issueId: "ISSUE-1",
      objective: "fix a typo",
      acceptanceCriterion: ["typo fixed"],
      validationAvailable: true,
      evidenceDir: evidenceDir!,
    });
  }

  function classifyLowRiskNoApprovalNeeded() {
    return runAutonomousClassify(ctx(), {
      repository: targetRepo!,
      baseRef: "HEAD",
      issueId: "ISSUE-1",
      objective: "fix a typo",
      acceptanceCriterion: ["typo fixed"],
      validationAvailable: true,
      evidenceDir: evidenceDir!,
      configPath: relaxedConfigPath!,
    });
  }

  function classifyMediumRisk() {
    return runAutonomousClassify(ctx(), {
      repository: targetRepo!,
      baseRef: "HEAD",
      issueId: "ISSUE-2",
      objective: "add a network call",
      acceptanceCriterion: ["works"],
      requestedPermission: ["network"],
      validationAvailable: true,
      evidenceDir: evidenceDir!,
    });
  }

  it("inspect reports a clean, resolvable target repository", async () => {
    const result = runAutonomousInspect(ctx(), { repository: targetRepo!, baseRef: "HEAD" });
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    const data = result.data as { preflight: { isGitRepository: boolean; repositoryDirty: boolean; baseRefResolvable: boolean } };
    expect(data.preflight).toEqual({ isGitRepository: true, repositoryDirty: false, baseRefResolvable: true, resolvedBaseCommit: headSha });
  });

  it("inspect refuses to target the AIQT product's own repository", () => {
    const aiqtRoot = join(process.cwd());
    const result = runAutonomousInspect(ctx(), { repository: aiqtRoot, baseRef: "HEAD" });
    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
  });

  it("classify rejects a candidate missing required fields", async () => {
    const result = await runAutonomousClassify(ctx(), { repository: targetRepo!, baseRef: "HEAD", evidenceDir: evidenceDir! });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
  });

  it("classify accepts candidate input via --from-file", async () => {
    const inputPath = join(makeTempDir("aiqt-cli-input-"), "candidate.json");
    mkdirSync(join(inputPath, ".."), { recursive: true });
    writeFileSync(
      inputPath,
      JSON.stringify({
        issueId: "ISSUE-FILE",
        source: "manual",
        repository: targetRepo,
        baseRef: "HEAD",
        objective: "fix from a file",
        acceptanceCriteria: ["done"],
      }),
    );
    const result = await runAutonomousClassify(ctx(), { fromFile: inputPath, validationAvailable: true, evidenceDir: evidenceDir! });
    expect(result.status).toBe("passed");
    removeDir(join(inputPath, ".."));
  });

  it("classify accepts candidate input via --stdin", async () => {
    const payload = JSON.stringify({
      issueId: "ISSUE-STDIN",
      source: "manual",
      repository: targetRepo,
      baseRef: "HEAD",
      objective: "fix from stdin",
      acceptanceCriteria: ["done"],
    });
    const fakeStdin = Readable.from([payload]) as unknown as StdinLike;
    fakeStdin.isTTY = false;
    const result = await runAutonomousClassify(ctx(), { stdin: true, validationAvailable: true, evidenceDir: evidenceDir! }, { stdin: fakeStdin });
    expect(result.status).toBe("passed");
  });

  it("classify refuses to target the AIQT product's own repository", async () => {
    const result = await runAutonomousClassify(ctx(), {
      repository: process.cwd(),
      baseRef: "HEAD",
      issueId: "ISSUE-1",
      objective: "x",
      acceptanceCriterion: ["y"],
      validationAvailable: true,
      evidenceDir: evidenceDir!,
    });
    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
  });

  it("a low-risk candidate still requires approval under the safe default policy (approvalPolicy: always_required)", async () => {
    const result = await classifyLowRiskRequiringApproval();
    expect(result.status).toBe("passed");
    const data = result.data as { runId: string; status: string };
    expect(data.status).toBe("awaiting_approval");
    expect(result.nextRecommendedCommand).toBe("aiqt autonomous approve");
  });

  it("a low-risk candidate classifies straight to a runnable state when the operator relaxes approvalPolicy to required_for_elevated", async () => {
    const result = await classifyLowRiskNoApprovalNeeded();
    expect(result.status).toBe("passed");
    const data = result.data as { runId: string; status: string };
    expect(data.status).toBe("classified");
    expect(result.nextRecommendedCommand).toBe("aiqt autonomous run");
  });

  it("a medium-risk (elevated-permission) candidate requires approval before it may run", async () => {
    const classifyResult = await classifyMediumRisk();
    const runId = (classifyResult.data as { runId: string }).runId;

    const runResult = runAutonomousRun(ctx(), { run: runId, simulate: true, evidenceDir: evidenceDir! });
    expect(runResult.status).toBe("blocked");
    expect(runResult.exitCode).toBe(2);

    const approveResult = await runAutonomousApprove(ctx(), { run: runId, yes: true, evidenceDir: evidenceDir! });
    expect(approveResult.status).toBe("passed");

    const runAfterApproval = runAutonomousRun(ctx(), { run: runId, simulate: true, evidenceDir: evidenceDir! });
    expect(runAfterApproval.status).toBe("needs_input");
    expect(runAfterApproval.exitCode).toBe(10);
  });

  it("approve is rejected non-interactively without --yes", async () => {
    const classifyResult = await classifyMediumRisk();
    const runId = (classifyResult.data as { runId: string }).runId;
    const fakeStdin: StdinLike = { on: () => fakeStdin, setEncoding: () => fakeStdin, isTTY: false };
    const result = await runAutonomousApprove(ctx(), { run: runId, evidenceDir: evidenceDir! }, { stdin: fakeStdin });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
  });

  it("approve prompts interactively when a TTY is available and no --yes is given", async () => {
    const classifyResult = await classifyMediumRisk();
    const runId = (classifyResult.data as { runId: string }).runId;
    const fakeStdin: StdinLike = { on: () => fakeStdin, setEncoding: () => fakeStdin, isTTY: true };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const result = await runAutonomousApprove(ctx(), { run: runId, evidenceDir: evidenceDir! }, { stdin: fakeStdin, confirmFn: confirmFn as never });
    expect(confirmFn).toHaveBeenCalledOnce();
    expect(result.status).toBe("passed");
    expect((result.data as { approval: { approvedBy: string } }).approval.approvedBy).toBe("interactive");
  });

  it("run without --simulate (M37-WU03) creates a bounded agent request and pauses awaiting import -- it never produces a fake result and never creates a real worktree itself", async () => {
    const classifyResult = await classifyLowRiskNoApprovalNeeded();
    const runId = (classifyResult.data as { runId: string }).runId;
    const result = runAutonomousRun(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: relaxedConfigPath! });
    expect(result.status).toBe("needs_input");
    expect(result.exitCode).toBe(10);
    expect((result.data as { agentRequestId: string }).agentRequestId).toMatch(/^agentreq-/);

    const { loadAutonomousRunRecord } = await import("../../src/services/autonomous-run-store.js");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.status).toBe("executing");
    expect(loaded.record.agentRequestId).not.toBeNull();
  });

  it("run --simulate produces a preview evidence packet that never claims a real result", async () => {
    const classifyResult = await classifyLowRiskNoApprovalNeeded();
    const runId = (classifyResult.data as { runId: string }).runId;
    const result = runAutonomousRun(ctx(), { run: runId, simulate: true, evidenceDir: evidenceDir!, configPath: relaxedConfigPath! });
    expect(result.status).toBe("needs_input");
    expect(result.warnings[0].message).toMatch(/SIMULATED RUN/);
  });

  it("a stale approval (budgets changed after approval) is rejected at run time", async () => {
    const classifyResult = await classifyMediumRisk();
    const runId = (classifyResult.data as { runId: string }).runId;
    await runAutonomousApprove(ctx(), { run: runId, yes: true, evidenceDir: evidenceDir! });

    // Simulate the run record's budgets changing after approval by
    // re-saving the record with different budgets, exactly as a future
    // "aiqt autonomous classify --refine" or config change might.
    const { loadAutonomousRunRecord, saveAutonomousRunRecord } = await import("../../src/services/autonomous-run-store.js");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    saveAutonomousRunRecord({ ...loaded.record, budgets: { ...loaded.record.budgets, maxCommandCount: 999 } }, evidenceDir!);

    const result = runAutonomousRun(ctx(), { run: runId, simulate: true, evidenceDir: evidenceDir! });
    expect(result.status).toBe("blocked");
    expect(result.summary).toMatch(/stale/i);
  });

  it("status reports full lifecycle/candidate/classification/budgets/approval/evidence-availability visibility", async () => {
    const classifyResult = await classifyLowRiskNoApprovalNeeded();
    const runId = (classifyResult.data as { runId: string }).runId;
    const before = runAutonomousStatus(ctx(), { run: runId, evidenceDir: evidenceDir! });
    const beforeData = before.data as { evidenceAvailable: boolean; candidate: unknown; safetyAssessment: unknown; budgets: unknown; approval: unknown };
    expect(beforeData.evidenceAvailable).toBe(false);
    expect(beforeData.candidate).toBeDefined();
    expect(beforeData.safetyAssessment).toBeDefined();
    expect(beforeData.budgets).toBeDefined();
    expect(beforeData.approval).toBeNull();

    runAutonomousRun(ctx(), { run: runId, simulate: true, evidenceDir: evidenceDir!, configPath: relaxedConfigPath! });
    const after = runAutonomousStatus(ctx(), { run: runId, evidenceDir: evidenceDir! });
    expect((after.data as { evidenceAvailable: boolean }).evidenceAvailable).toBe(true);
  });

  it("status with no --run lists all recorded run ids", async () => {
    const a = await classifyLowRiskRequiringApproval();
    const runIdA = (a.data as { runId: string }).runId;
    const result = runAutonomousStatus(ctx(), { evidenceDir: evidenceDir! });
    expect((result.data as { runIds: string[] }).runIds).toContain(runIdA);
  });

  it("cancel is allowed for a non-terminal run and creates an audit event", async () => {
    const classifyResult = await classifyLowRiskRequiringApproval();
    const runId = (classifyResult.data as { runId: string }).runId;
    const result = runAutonomousCancel(ctx(), { run: runId, reason: "operator changed their mind", evidenceDir: evidenceDir! });
    expect(result.status).toBe("passed");

    const { loadAutonomousRunRecord } = await import("../../src/services/autonomous-run-store.js");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.status).toBe("cancelled");
    expect(loaded.record.auditLog.some((e) => e.event === "autonomous_run.cancelled")).toBe(true);
  });

  it("cancel is rejected for an already-terminal run", async () => {
    const classifyResult = await classifyLowRiskRequiringApproval();
    const runId = (classifyResult.data as { runId: string }).runId;
    runAutonomousCancel(ctx(), { run: runId, reason: "first cancel", evidenceDir: evidenceDir! });
    const second = runAutonomousCancel(ctx(), { run: runId, reason: "second cancel", evidenceDir: evidenceDir! });
    expect(second.status).toBe("blocked");
  });

  it("result reports needs_input before a run has produced evidence, and the real packet after", async () => {
    const classifyResult = await classifyLowRiskNoApprovalNeeded();
    const runId = (classifyResult.data as { runId: string }).runId;

    const before = runAutonomousResult(ctx(), { run: runId, evidenceDir: evidenceDir! });
    expect(before.status).toBe("needs_input");
    expect(before.exitCode).toBe(10);

    runAutonomousRun(ctx(), { run: runId, simulate: true, evidenceDir: evidenceDir!, configPath: relaxedConfigPath! });
    const after = runAutonomousResult(ctx(), { run: runId, evidenceDir: evidenceDir! });
    expect((after.data as { resultState: string }).resultState).toBe("needs_input");
    expect((after.data as { runId: string }).runId).toBe(runId);
  });

  it("cleanup refuses a non-terminal run and succeeds for a terminal one, deleting only that run's own record", async () => {
    const a = await classifyLowRiskRequiringApproval();
    const runIdA = (a.data as { runId: string }).runId;
    const b = await classifyLowRiskRequiringApproval();
    const runIdB = (b.data as { runId: string }).runId;

    const refused = runAutonomousCleanup(ctx(), { run: runIdA, evidenceDir: evidenceDir! });
    expect(refused.status).toBe("blocked");

    runAutonomousCancel(ctx(), { run: runIdA, reason: "done testing", evidenceDir: evidenceDir! });
    const cleaned = runAutonomousCleanup(ctx(), { run: runIdA, evidenceDir: evidenceDir! });
    expect(cleaned.status).toBe("passed");

    const { listAutonomousRunIds } = await import("../../src/services/autonomous-run-store.js");
    const remaining = listAutonomousRunIds(evidenceDir!);
    expect(remaining).toContain(runIdB);
    expect(remaining).not.toContain(runIdA);
  });

  it("every command result follows the M33 CommandResult contract shape", async () => {
    const result = await classifyLowRiskRequiringApproval();
    expect(result).toMatchObject({
      status: expect.any(String),
      action: "autonomous",
      completedActions: expect.any(Array),
      changedFiles: expect.any(Array),
      affectedItems: expect.any(Array),
      blockingIssues: expect.any(Array),
      warnings: expect.any(Array),
      requiresHumanInput: expect.any(Boolean),
      exitCode: expect.any(Number),
    });
  });

  it("no scenario ever creates a real worktree or modifies the target repository's default branch/HEAD", async () => {
    const branchBefore = await import("node:child_process").then((cp) => cp.execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim());
    const headBefore = await import("node:child_process").then((cp) => cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim());

    const classifyResult = await classifyLowRiskNoApprovalNeeded();
    const runId = (classifyResult.data as { runId: string }).runId;
    runAutonomousRun(ctx(), { run: runId, simulate: true, evidenceDir: evidenceDir!, configPath: relaxedConfigPath! });

    const cp = await import("node:child_process");
    const branchAfter = cp.execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    const headAfter = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
    const worktreeListing = cp.execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: targetRepo!, encoding: "utf8" });
    expect(worktreeListing.split("\n\n").filter((b) => b.trim())).toHaveLength(1); // only the main worktree, never a second one
  });
});
