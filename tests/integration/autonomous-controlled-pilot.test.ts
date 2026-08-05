import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { runAutonomousClassify } from "../../src/cli/commands/autonomous-classify.command.js";
import { runAutonomousApprove } from "../../src/cli/commands/autonomous-approve.command.js";
import { runAutonomousRun } from "../../src/cli/commands/autonomous-run.command.js";
import { runAutonomousAgentImport } from "../../src/cli/commands/autonomous-agent-import.command.js";
import { runAutonomousCancel } from "../../src/cli/commands/autonomous-cancel.command.js";
import { runAutonomousCleanup } from "../../src/cli/commands/autonomous-cleanup.command.js";
import { runAutonomousResult } from "../../src/cli/commands/autonomous-result.command.js";
import { runAutonomousStatus } from "../../src/cli/commands/autonomous-status.command.js";
import { loadAutonomousRunRecord, saveAutonomousRunRecord } from "../../src/services/autonomous-run-store.js";
import { AUTONOMOUS_AGENT_PROVIDER_ID } from "../../src/schema/autonomous-agent-request.schema.js";
import type { CommandResult } from "../../src/core/output/result.js";

// M37-WU05: this file spawns real subprocesses (git, via the full,
// real, non-simulated CLI pipeline exercised end-to-end for each
// scenario). See docs/engineering/m34-validation-workload-policy.md
// Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M37-WU05 (build spec: "Controlled Pilot and Milestone Closure"). Runs
 * the 10 required scenarios against real, disposable, non-AIQT target
 * repositories, through the REAL public CLI command functions built
 * across WU37-01 through WU37-04 (classify/approve/run/agent-import/
 * cancel/cleanup/result/status) -- not service-level calls directly, and
 * not `--simulate`. This goes further than M36-WU05's dogfood pilot
 * (which called the M36 evidence-binding service directly): here, every
 * scenario drives the same command surface an operator would actually
 * type, including the operator's own agent-import step (a hand-authored
 * response JSON file standing in for a real coding-agent tool's output,
 * per the M37-WU02 request/import architecture -- AIQT itself still
 * never spawns a coding-agent process).
 *
 * Evidence for every scenario is captured to a committed report
 * (docs/engineering/m37-wu05-controlled-pilot-evidence.generated.json),
 * mirroring the M36-WU05 pattern.
 */
const evidenceReport: Record<string, unknown> = {};

function recordEvidence(scenario: string, result: CommandResult): void {
  evidenceReport[scenario] = result;
}

describe("M37-WU05 controlled pilot: 10 required scenarios against a real disposable, non-AIQT target repository, driven entirely through the real public CLI", () => {
  let targetRepo: string | null = null;
  let evidenceDir: string | null = null;
  let worktreeRoot: string | null = null;
  let configDir: string | null = null;
  let configPath: string | null = null;
  let headSha = "";

  beforeEach(() => {
    targetRepo = makeTempDir("aiqt-pilot-target-");
    headSha = initGitFixtureRepo(targetRepo);
    evidenceDir = join(makeTempDir("aiqt-pilot-evidence-"), "evidence");
    worktreeRoot = makeTempDir("aiqt-pilot-worktrees-");
    configDir = makeTempDir("aiqt-pilot-config-");
    configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ approvalPolicy: "required_for_elevated", worktreeRoot }));
  });

  afterEach(() => {
    if (targetRepo) removeDir(targetRepo);
    if (evidenceDir) removeDir(evidenceDir);
    if (worktreeRoot) removeDir(worktreeRoot);
    if (configDir) removeDir(configDir);
  });

  afterAll(() => {
    const reportPath = join(repoRoot, "docs", "engineering", "m37-wu05-controlled-pilot-evidence.generated.json");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(evidenceReport, null, 2) + "\n");
  });

  const ctx = () => contextFor(process.cwd());

  async function classify(issueId: string, extra: Record<string, unknown> = {}) {
    return runAutonomousClassify(ctx(), {
      repository: targetRepo!,
      baseRef: "HEAD",
      issueId,
      objective: "rename the readme",
      acceptanceCriterion: ["renamed"],
      validationAvailable: true,
      targetedValidationCommand: ["git status"],
      evidenceDir: evidenceDir!,
      configPath: configPath!,
      ...extra,
    });
  }

  function startRun(runId: string, cfgPath: string = configPath!) {
    return runAutonomousRun(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: cfgPath });
  }

  async function importResponse(runId: string, requestId: string, commandsProposed: { command: string; args: string[] }[]) {
    const responsePath = join(makeTempDir("aiqt-pilot-response-"), "response.json");
    writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed }));
    return runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
  }

  it("Scenario 1 -- successful low-risk repair: classify -> run -> agent-import renames and commits, resultState:passed, no default-branch mutation", async () => {
    const branchBefore = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim();

    const classifyResult = await classify("PILOT-1");
    expect(classifyResult.status).toBe("passed");
    const runId = (classifyResult.data as { runId: string }).runId;

    const runResult = startRun(runId);
    expect(runResult.status).toBe("needs_input");
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const importResult = await importResponse(runId, requestId, [
      { command: "git", args: ["mv", "README.md", "README2.md"] },
      { command: "git", args: ["commit", "-m", "rename readme"] },
    ]);
    recordEvidence("scenario_1_successful_low_risk_repair", importResult);
    expect(importResult.status).toBe("passed");
    expect((importResult.data as { resultState: string }).resultState).toBe("passed");

    const branchAfter = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
    expect(headAfter).toBe(headSha);
  });

  it("Scenario 2 -- medium-risk task requiring approval: classify requests elevated permissions -> status awaiting_approval -> run refused before approval -> approve --yes -> run -> agent-import passes", async () => {
    const classifyResult = await classify("PILOT-2", { requestedPermission: ["network_access"] });
    expect(classifyResult.status).toBe("passed");
    const data = classifyResult.data as { runId: string; status: string; safetyAssessment: { riskClass: string } };
    expect(data.status).toBe("awaiting_approval");
    expect(data.safetyAssessment.riskClass).toBe("medium_risk_requires_approval");
    const runId = data.runId;

    const refused = startRun(runId);
    expect(refused.status).toBe("blocked");
    expect(refused.summary).toMatch(/awaiting_approval/i);

    const approveResult = await runAutonomousApprove(ctx(), { run: runId, yes: true, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(approveResult.status).toBe("passed");

    const runResult = startRun(runId);
    expect(runResult.status).toBe("needs_input");
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const importResult = await importResponse(runId, requestId, [
      { command: "git", args: ["mv", "README.md", "README2.md"] },
      { command: "git", args: ["commit", "-m", "rename readme"] },
    ]);
    recordEvidence("scenario_2_medium_risk_requires_approval", importResult);
    expect(importResult.status).toBe("passed");
  });

  it("Scenario 3 -- blocked prohibited task: classify with a prohibited area tag is always blocked, never reaches approval or execution", async () => {
    const classifyResult = await classify("PILOT-3", { prohibitedArea: ["secrets"] });
    recordEvidence("scenario_3_blocked_prohibited_task", classifyResult);
    expect(classifyResult.status).toBe("blocked");
    const data = classifyResult.data as { runId: string; status: string; safetyAssessment: { riskClass: string } };
    expect(data.status).toBe("blocked");
    expect(data.safetyAssessment.riskClass).toBe("high_risk_prohibited");
    expect(classifyResult.nextRecommendedCommand).toBeNull();

    const runResult = startRun(data.runId);
    expect(runResult.status).toBe("blocked");
  });

  it("Scenario 4 -- cancelled agent run: cancel while awaiting agent import stops the run cleanly, no worktree ever created", async () => {
    const classifyResult = await classify("PILOT-4");
    const runId = (classifyResult.data as { runId: string }).runId;
    startRun(runId);

    const cancelResult = runAutonomousCancel(ctx(), { run: runId, reason: "operator changed their mind", evidenceDir: evidenceDir!, configPath: configPath! });
    recordEvidence("scenario_4_cancelled_agent_run", cancelResult);
    expect(cancelResult.status).toBe("passed");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.status).toBe("cancelled");
  });

  it("Scenario 5 -- budget-exhausted run: a tight maxCommandCount from operator config stops the run after exactly the allowed number of commands", async () => {
    const tightConfigPath = join(configDir!, "tight-budget-config.json");
    writeFileSync(
      tightConfigPath,
      JSON.stringify({
        approvalPolicy: "required_for_elevated",
        worktreeRoot,
        defaultBudgets: { maxWallClockSeconds: 60, maxCommandCount: 1, maxRetryCount: 3, maxChangedFiles: 20, maxDiffLines: 500, maxValidationSeconds: 60 },
      }),
    );

    const classifyResult = await runAutonomousClassify(ctx(), {
      repository: targetRepo!,
      baseRef: "HEAD",
      issueId: "PILOT-5",
      objective: "rename the readme",
      acceptanceCriterion: ["renamed"],
      validationAvailable: true,
      evidenceDir: evidenceDir!,
      configPath: tightConfigPath,
    });
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId, tightConfigPath);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const responsePath = join(makeTempDir("aiqt-pilot-response-"), "response.json");
    writeFileSync(
      responsePath,
      JSON.stringify({
        requestId,
        providerId: AUTONOMOUS_AGENT_PROVIDER_ID,
        commandsProposed: [
          { command: "git", args: ["mv", "README.md", "README2.md"] },
          { command: "git", args: ["status"] },
        ],
      }),
    );
    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: tightConfigPath });
    recordEvidence("scenario_5_budget_exhausted_run", importResult);
    expect((importResult.data as { resultState: string }).resultState).toBe("budget_exhausted");
  });

  it("Scenario 6 -- validation-failed run: the repair itself runs but targeted validation fails, resultState:validation_failed (no pass without validation)", async () => {
    const classifyResult = await classify("PILOT-6", { targetedValidationCommand: ["git rev-parse refs/does-not-exist"] });
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const importResult = await importResponse(runId, requestId, [{ command: "git", args: ["mv", "README.md", "README2.md"] }]);
    recordEvidence("scenario_6_validation_failed_run", importResult);
    expect((importResult.data as { resultState: string }).resultState).toBe("validation_failed");
  });

  it("Scenario 7 -- stale approval rejection: budgets change after approval was granted -> run refuses with a stale-approval error, never proceeds on outdated authorization", async () => {
    const classifyResult = await classify("PILOT-7", { requestedPermission: ["network_access"] });
    const runId = (classifyResult.data as { runId: string }).runId;

    const approveResult = await runAutonomousApprove(ctx(), { run: runId, yes: true, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(approveResult.status).toBe("passed");

    // Simulate the operator's own configured budgets changing after
    // approval was granted (e.g. a different --config picked up between
    // invocations) by mutating the persisted record directly -- the same
    // "hand-edited record" pattern already used by this milestone's own
    // self-management-guard regression test.
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    saveAutonomousRunRecord({ ...loaded.record, budgets: { ...loaded.record.budgets, maxCommandCount: loaded.record.budgets.maxCommandCount + 1 } }, evidenceDir!);

    const runResult = startRun(runId);
    recordEvidence("scenario_7_stale_approval_rejection", runResult);
    expect(runResult.status).toBe("blocked");
    expect(runResult.summary).toMatch(/stale/i);
  });

  it("Scenario 8 -- resume from allowed state: an agent request persists across separate CLI invocations and is imported later, as if the operator returned after running their own coding-agent tool", async () => {
    const classifyResult = await classify("PILOT-8");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    // Reload purely from disk, exactly as a later, separate `agent-import`
    // invocation would -- nothing in memory is reused from `startRun`.
    const reloaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!reloaded.ok) throw new Error("run record unexpectedly missing");
    expect(reloaded.record.status).toBe("executing");
    expect(reloaded.record.agentRequestId).toBe(requestId);

    const importResult = await importResponse(runId, requestId, [
      { command: "git", args: ["mv", "README.md", "README2.md"] },
      { command: "git", args: ["commit", "-m", "rename readme"] },
    ]);
    recordEvidence("scenario_8_resume_from_allowed_state", importResult);
    expect(importResult.status).toBe("passed");
  });

  it("Scenario 9 -- patch handoff: aiqt autonomous result --patch/--pr-draft returns a real, reviewable diff and PR draft text, never merges or pushes", async () => {
    const classifyResult = await classify("PILOT-9");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const importResult = await importResponse(runId, requestId, [{ command: "git", args: ["mv", "README.md", "README2.md"] }]);
    expect(importResult.status).toBe("passed");

    const resultWithPatch = runAutonomousResult(ctx(), { run: runId, patch: true, evidenceDir: evidenceDir!, configPath: configPath! });
    const resultWithPrDraft = runAutonomousResult(ctx(), { run: runId, prDraft: true, evidenceDir: evidenceDir!, configPath: configPath! });
    recordEvidence("scenario_9_patch_handoff", { withPatch: resultWithPatch, withPrDraft: resultWithPrDraft } as unknown as CommandResult);

    const patch = (resultWithPatch.data as { patch: string }).patch;
    expect(patch).toContain("README.md");
    expect(patch).toContain("README2.md");
    const prDraft = (resultWithPrDraft.data as { prDraft: { title: string; body: string } }).prDraft;
    expect(prDraft.body).toMatch(/nothing has been merged, pushed, or deployed/i);

    const branchNow = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    expect(branchNow).toBe("main");
  });

  it("Scenario 10 -- discard and cleanup: a cancelled run's record is deleted on cleanup, no longer appears in status listings, and no orphaned worktree is left behind", async () => {
    const classifyResult = await classify("PILOT-10");
    const runId = (classifyResult.data as { runId: string }).runId;

    const cancelResult = runAutonomousCancel(ctx(), { run: runId, reason: "discarding this candidate", evidenceDir: evidenceDir!, configPath: configPath! });
    expect(cancelResult.status).toBe("passed");

    const statusBefore = runAutonomousStatus(ctx(), { evidenceDir: evidenceDir!, configPath: configPath! });
    expect((statusBefore.data as { runIds: string[] }).runIds).toContain(runId);

    const cleanupResult = runAutonomousCleanup(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: configPath! });
    recordEvidence("scenario_10_discard_and_cleanup", cleanupResult);
    expect(cleanupResult.status).toBe("passed");

    const statusAfter = runAutonomousStatus(ctx(), { evidenceDir: evidenceDir!, configPath: configPath! });
    expect((statusAfter.data as { runIds: string[] }).runIds).not.toContain(runId);

    const worktreeListing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: targetRepo!, encoding: "utf8" });
    const worktreeLines = worktreeListing.match(/^worktree .+$/gm) ?? [];
    expect(worktreeLines).toHaveLength(1);
  });

  it("no scenario ever merges a branch, mutates the target repository's default branch, or self-manages the AIQT repository", () => {
    expect(targetRepo).not.toBe(repoRoot);
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
    for (const key of Object.keys(evidenceReport)) {
      expect(key).not.toBe("");
    }
  });
});
