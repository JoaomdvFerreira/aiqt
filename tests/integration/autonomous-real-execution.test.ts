import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { runAutonomousClassify } from "../../src/cli/commands/autonomous-classify.command.js";
import { runAutonomousRun } from "../../src/cli/commands/autonomous-run.command.js";
import { runAutonomousAgentImport } from "../../src/cli/commands/autonomous-agent-import.command.js";
import { runAutonomousCancel } from "../../src/cli/commands/autonomous-cancel.command.js";
import { runAutonomousCleanup } from "../../src/cli/commands/autonomous-cleanup.command.js";
import { runAutonomousResult } from "../../src/cli/commands/autonomous-result.command.js";
import { loadAutonomousRunRecord } from "../../src/services/autonomous-run-store.js";
import { AUTONOMOUS_AGENT_PROVIDER_ID } from "../../src/schema/autonomous-agent-request.schema.js";

// M37-WU03: this file spawns real subprocesses (git, via the real
// worktree lifecycle -- createAutonomousWorktree/removeAutonomousWorktree
// -- invoked for the first time from a public CLI command in this
// milestone). See docs/engineering/m34-validation-workload-policy.md
// Sec 6.1.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M37-WU03 (build spec: "End-to-End CLI Orchestration and Resumability").
 * Exercises the REAL (non-simulated) pipeline end-to-end against a real
 * disposable, non-AIQT target repository: classify -> run (creates an
 * agent request, no worktree yet) -> agent-import (creates a real
 * worktree, executes real commands via M36-WU04's already-reviewed
 * produceAutonomousEvidencePacket, cleans up). This is the first Work
 * Unit in which any CLI command performs a real `git worktree add`.
 */
describe("aiqt autonomous real (non-simulated) execution (M37-WU03, real disposable target repository)", () => {
  let targetRepo: string | null = null;
  let evidenceDir: string | null = null;
  let worktreeRoot: string | null = null;
  let configDir: string | null = null;
  let configPath: string | null = null;
  let headSha = "";

  beforeEach(() => {
    targetRepo = makeTempDir("aiqt-real-target-");
    headSha = initGitFixtureRepo(targetRepo);
    evidenceDir = join(makeTempDir("aiqt-real-evidence-"), "evidence");
    worktreeRoot = makeTempDir("aiqt-real-worktrees-");
    configDir = makeTempDir("aiqt-real-config-");
    configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ approvalPolicy: "required_for_elevated", worktreeRoot }));
  });

  afterEach(() => {
    if (targetRepo) removeDir(targetRepo);
    if (evidenceDir) removeDir(evidenceDir);
    if (worktreeRoot) removeDir(worktreeRoot);
    if (configDir) removeDir(configDir);
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

  function startRun(runId: string) {
    return runAutonomousRun(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: configPath! });
  }

  it("full real pipeline: classify -> run -> agent-import produces resultState:passed, a real worktree is created and cleaned up, and the target repo's default branch/HEAD are untouched", async () => {
    const branchBefore = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim();

    const classifyResult = await classify("ISSUE-1");
    const runId = (classifyResult.data as { runId: string }).runId;

    const runResult = startRun(runId);
    expect(runResult.status).toBe("needs_input");
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    // Commands PROPOSE a rename AND commit it on the run's own
    // `autonomous/` branch (never main -- see the branch/HEAD assertions
    // below) -- a realistic real-agent shape that leaves the worktree
    // clean, so `git worktree remove` can succeed without --force
    // (this repository never passes --force, by design).
    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    const fs = await import("node:fs");
    fs.writeFileSync(
      responsePath,
      JSON.stringify({
        requestId,
        providerId: AUTONOMOUS_AGENT_PROVIDER_ID,
        commandsProposed: [
          { command: "git", args: ["mv", "README.md", "README2.md"] },
          { command: "git", args: ["commit", "-m", "rename readme"] },
        ],
      }),
    );

    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(importResult.status).toBe("passed");
    expect((importResult.data as { resultState: string }).resultState).toBe("passed");

    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.status).toBe("completed");
    expect(loaded.record.evidencePacket?.workspace?.cleanupStatus).toBe("cleaned");

    // The real proof, not just the reported field: the worktree must
    // actually be gone from the target repo's own worktree list, and
    // the default branch/HEAD must be byte-identical to before the run.
    const worktreeListing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: targetRepo!, encoding: "utf8" });
    const worktreeLines = worktreeListing.match(/^worktree .+$/gm) ?? [];
    expect(worktreeLines, `expected only the main worktree to remain, got: ${JSON.stringify(worktreeLines)}`).toHaveLength(1); // only the main worktree remains
    expect(worktreeListing).not.toContain(loaded.record.evidencePacket!.workspace!.worktreePath.replace(/\\/g, "/"));

    const branchAfter = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
    expect(headAfter).toBe(headSha);
  });

  it("aiqt autonomous result --patch/--pr-draft returns a real patch and a PR draft for a completed real run, once the worktree is already gone (the branch survives in the target repo)", async () => {
    const classifyResult = await classify("ISSUE-PATCH");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    const fs = await import("node:fs");
    fs.writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [{ command: "git", args: ["mv", "README.md", "README2.md"] }] }));
    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(importResult.status).toBe("passed");

    const resultWithPatch = runAutonomousResult(ctx(), { run: runId, patch: true, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(resultWithPatch.status).toBe("passed");
    const patch = (resultWithPatch.data as { patch: string }).patch;
    expect(patch).toContain("README.md");
    expect(patch).toContain("README2.md");

    const resultWithPrDraft = runAutonomousResult(ctx(), { run: runId, prDraft: true, evidenceDir: evidenceDir!, configPath: configPath! });
    const prDraft = (resultWithPrDraft.data as { prDraft: { title: string; body: string } }).prDraft;
    expect(prDraft.title).toContain("rename the readme");
    expect(prDraft.body).toMatch(/nothing has been merged, pushed, or deployed/i);

    // No merge, no push -- the branch exists in the target repo, main is
    // still untouched, and nothing was pushed anywhere (this is a fully
    // local, disposable target repo with no remote at all).
    const branchNow = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    expect(branchNow).toBe("main");
  });

  it("aiqt autonomous result --patch reports needs_input (not a patch) for a run with no evidence yet, and refuses once it has evidence but no workspace/branch to diff", async () => {
    const classifyResult = await classify("ISSUE-NO-WORKSPACE");
    const runId = (classifyResult.data as { runId: string }).runId;

    // No evidence at all yet -- --patch is simply not reachable, the
    // same needs_input as a plain `result` call without --patch.
    const beforeRun = runAutonomousResult(ctx(), { run: runId, patch: true, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(beforeRun.status).toBe("needs_input");

    // A workspace_failed outcome (invalid worktree root) DOES reach a
    // terminal evidencePacket, but with no `workspace` field at all --
    // --patch must refuse cleanly rather than crash on a missing branch.
    const { saveAutonomousRunRecord } = await import("../../src/services/autonomous-run-store.js");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    saveAutonomousRunRecord(
      {
        ...loaded.record,
        status: "failed",
        evidencePacket: {
          runId,
          candidate: loaded.record.candidate,
          safetyAssessment: loaded.record.safetyAssessment,
          commandsExecuted: [],
          filesChanged: [],
          findings: [],
          residualRisk: "Workspace could not be prepared.",
          resultState: "failed",
          recommendedHumanAction: "provide_missing_input",
        },
      },
      evidenceDir!,
    );
    const afterFailure = runAutonomousResult(ctx(), { run: runId, patch: true, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(afterFailure.status).toBe("failed");
  });

  it("a bare, uncommitted rename with no explicit commit in the proposed commands still reports cleanupStatus:cleaned -- M37-WU04's commit-preparation step (git add -A && git commit) auto-commits it before cleanup runs", async () => {
    const classifyResult = await classify("ISSUE-BARE-RENAME");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    const fs = await import("node:fs");
    fs.writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [{ command: "git", args: ["mv", "README.md", "README2.md"] }] }));

    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(importResult.status).toBe("passed");
    expect((importResult.data as { workspace: { cleanupStatus: string } }).workspace.cleanupStatus).toBe("cleaned");

    const worktreeListing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: targetRepo!, encoding: "utf8" });
    const worktreeLines = worktreeListing.match(/^worktree .+$/gm) ?? [];
    expect(worktreeLines, `expected only the main worktree to remain, got: ${JSON.stringify(worktreeLines)}`).toHaveLength(1);
  });

  it("reports cleanupStatus:cleanup_failed (not a false 'cleaned') for a run that never reaches commit-preparation at all -- an earlier command leaves an uncommitted change on disk before a later command is denied and the run stops -- regression test for a real M36-WU04 defect found while building this Work Unit's own tests (evidence-binding-service.ts previously discarded removeAutonomousWorktree's result entirely and hardcoded \"cleaned\")", async () => {
    const classifyResult = await classify("ISSUE-DIRTY");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    // The rename runs (uncommitted), then the destructive command is
    // denied and the run stops before ever reaching commit-preparation
    // (which only ever runs for a "completed" outcome) -- the worktree
    // is left genuinely dirty, and `git worktree remove` (never passed
    // --force by this repository, by design) genuinely refuses to
    // remove it.
    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    const fs = await import("node:fs");
    fs.writeFileSync(
      responsePath,
      JSON.stringify({
        requestId,
        providerId: AUTONOMOUS_AGENT_PROVIDER_ID,
        commandsProposed: [
          { command: "git", args: ["mv", "README.md", "README2.md"] },
          { command: "rm", args: ["-rf", "."] },
        ],
      }),
    );

    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
    expect((importResult.data as { workspace: { cleanupStatus: string } }).workspace.cleanupStatus).toBe("cleanup_failed");

    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.evidencePacket?.workspace?.cleanupStatus).toBe("cleanup_failed");

    // The real proof: the worktree genuinely still exists, matching
    // what the (now-honest) cleanupStatus reports. Matched by branch
    // name, not the raw path string -- Windows may report the same
    // directory via a short (8.3) or long name inconsistently between
    // the record (written at worktree-creation time) and this fresh
    // `git worktree list` call, which is a path-normalization detail,
    // not a location mismatch.
    const worktreeListing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: targetRepo!, encoding: "utf8" });
    expect(worktreeListing).toContain(loaded.record.evidencePacket!.workspace!.branch);

    // Manual cleanup, since this test intentionally created an orphaned
    // worktree -- afterEach's removeDir(worktreeRoot) alone would not
    // deregister it from the target repo's own .git/worktrees metadata.
    execFileSync("git", ["worktree", "remove", "--force", loaded.record.evidencePacket!.workspace!.worktreePath], { cwd: targetRepo! });
  });

  it("a command denied by policy mid-execution produces resultState:blocked, status:blocked, and still cleans up the worktree (exercises the M37-WU03 executing->blocked lifecycle correction)", async () => {
    const classifyResult = await classify("ISSUE-2");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    const fs = await import("node:fs");
    fs.writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [{ command: "rm", args: ["-rf", "."] }] }));

    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
    expect((importResult.data as { resultState: string }).resultState).toBe("blocked");

    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.status).toBe("blocked");
    expect(loaded.record.evidencePacket?.workspace?.cleanupStatus).toBe("cleaned");
  });

  it("concurrent duplicate execution is blocked: a second `run` against the same runId fails once the first has moved it to executing", async () => {
    const classifyResult = await classify("ISSUE-3");
    const runId = (classifyResult.data as { runId: string }).runId;
    const first = startRun(runId);
    expect(first.status).toBe("needs_input");
    const second = startRun(runId);
    expect(second.status).toBe("blocked");
    expect(second.exitCode).toBe(2);
  });

  it("cancellation is safe while a run is awaiting agent import (no real worktree exists yet at this stage)", async () => {
    const classifyResult = await classify("ISSUE-4");
    const runId = (classifyResult.data as { runId: string }).runId;
    startRun(runId);
    const cancelResult = runAutonomousCancel(ctx(), { run: runId, reason: "operator changed their mind", evidenceDir: evidenceDir!, configPath: configPath! });
    expect(cancelResult.status).toBe("passed");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.status).toBe("cancelled");
  });

  it("resumability: a run's agent request survives across separate CLI invocations and can be imported later (the natural 'resume' point for this architecture)", async () => {
    const classifyResult = await classify("ISSUE-5");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    // Simulate time passing / a separate process entirely by re-loading
    // the run purely from disk, exactly as a later `agent-import`
    // invocation would.
    const reloaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!reloaded.ok) throw new Error("run record unexpectedly missing");
    expect(reloaded.record.status).toBe("executing");
    expect(reloaded.record.agentRequestId).toBe(requestId);

    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    const fs = await import("node:fs");
    fs.writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [{ command: "git", args: ["status"] }] }));
    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(importResult.exitCode).toBeLessThanOrEqual(3); // reaches a real terminal result either way (validation_failed here, since git status alone doesn't rename the file)
  });

  it("rejects a relative worktreeRoot at the real-execution boundary rather than resolving it against an unpredictable cwd", async () => {
    const relativeConfigDir = makeTempDir("aiqt-real-relative-config-");
    const relativeConfigPath = join(relativeConfigDir, "config.json");
    const fs = await import("node:fs");
    fs.writeFileSync(relativeConfigPath, JSON.stringify({ approvalPolicy: "required_for_elevated", worktreeRoot: "./relative-worktrees" }));

    const classifyResult = await classify("ISSUE-6", { configPath: relativeConfigPath });
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = runAutonomousRun(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: relativeConfigPath });
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    fs.writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [] }));
    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: relativeConfigPath });
    expect(importResult.status).toBe("failed");
    expect(importResult.summary).toMatch(/not an absolute path/i);

    removeDir(relativeConfigDir);
  });

  it("self-management guard is re-checked at agent-import time, refusing to execute against the AIQT product's own repository even if a run record was somehow created targeting it", async () => {
    // classify() itself already refuses a self-targeting repository, so
    // this test constructs the scenario the defense-in-depth check in
    // autonomous-agent-import.command.ts guards against: a record whose
    // repositoryPath was altered after classification (e.g. by direct
    // file edit) to point at the AIQT repository.
    const classifyResult = await classify("ISSUE-7");
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = startRun(runId);
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const { saveAutonomousRunRecord } = await import("../../src/services/autonomous-run-store.js");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    const { dirname, join: pathJoin } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = pathJoin(dirname(fileURLToPath(import.meta.url)), "..", "..");
    saveAutonomousRunRecord({ ...loaded.record, repositoryPath: repoRoot }, evidenceDir!);

    const responsePath = join(makeTempDir("aiqt-real-response-"), "response.json");
    const fs = await import("node:fs");
    fs.writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [] }));
    const importResult = await runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(importResult.status).toBe("blocked");
    expect(importResult.summary).toMatch(/self-management/i);
  });

  it("cleanup refuses to delete a run record whose worktree cleanup previously failed, preserving the only reference to the orphaned path", async () => {
    const classifyResult = await classify("ISSUE-8");
    const runId = (classifyResult.data as { runId: string }).runId;
    const { saveAutonomousRunRecord } = await import("../../src/services/autonomous-run-store.js");
    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    saveAutonomousRunRecord(
      {
        ...loaded.record,
        status: "failed",
        evidencePacket: {
          runId,
          candidate: loaded.record.candidate,
          safetyAssessment: loaded.record.safetyAssessment,
          workspace: { sourceRepository: targetRepo!, baseRef: "HEAD", baseCommit: headSha, branch: "autonomous/x", worktreePath: "/some/orphaned/path", createdFiles: [], cleanupStatus: "cleanup_failed" },
          commandsExecuted: [],
          filesChanged: [],
          findings: [],
          residualRisk: "test",
          resultState: "failed",
          recommendedHumanAction: "discard",
        },
      },
      evidenceDir!,
    );
    const cleanupResult = runAutonomousCleanup(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: configPath! });
    expect(cleanupResult.status).toBe("blocked");
    expect(cleanupResult.summary).toMatch(/cleanup previously failed/i);
  });
});
