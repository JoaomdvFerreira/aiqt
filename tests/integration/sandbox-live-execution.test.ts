import { describe, it, expect, beforeAll, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { runAutonomousClassify } from "../../src/cli/commands/autonomous-classify.command.js";
import { runAutonomousRun } from "../../src/cli/commands/autonomous-run.command.js";
import { runAutonomousAgentImport } from "../../src/cli/commands/autonomous-agent-import.command.js";
import { runAutonomousCleanup } from "../../src/cli/commands/autonomous-cleanup.command.js";
import { loadAutonomousRunRecord, saveAutonomousRunRecord } from "../../src/services/autonomous-run-store.js";
import { AUTONOMOUS_AGENT_PROVIDER_ID } from "../../src/schema/autonomous-agent-request.schema.js";
import { DockerSandboxBackend } from "../../src/workspaces/sandbox-docker-backend.js";

vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const backend = new DockerSandboxBackend();
const availability = backend.checkAvailability();
const dockerAvailable = availability.available;

if (!dockerAvailable) {
  console.log(`[sandbox-live-execution.test.ts] Docker is not available on this host (${availability.reason}) -- real-container tests are skipped, not failed.`);
}

/**
 * M38-WU04 (build spec: "Integrate opt-in live execution with M37 CLI,
 * capability preflight, validation, self-review, evidence, crash
 * recovery, cleanup, and safe fallback"). Exercises `aiqt autonomous
 * agent-import --live` end-to-end through the real public CLI, against
 * a real Docker daemon -- self-skips (logged, not failed) when Docker
 * is unavailable, matching every other real-Docker suite this
 * milestone added.
 */
describe.skipIf(!dockerAvailable)("M38-WU04 aiqt autonomous agent-import --live (real Docker daemon required)", () => {
  let targetRepo: string | null = null;
  let evidenceDir: string | null = null;
  let worktreeRoot: string | null = null;
  let configDir: string | null = null;
  let liveConfigPath: string | null = null;
  let nonLiveConfigPath: string | null = null;

  beforeAll(() => {
    targetRepo = makeTempDir("aiqt-live-target-");
    initGitFixtureRepo(targetRepo);
    evidenceDir = join(makeTempDir("aiqt-live-evidence-"), "evidence");
    worktreeRoot = makeTempDir("aiqt-live-worktrees-");
    configDir = makeTempDir("aiqt-live-config-");
    liveConfigPath = join(configDir, "live-config.json");
    nonLiveConfigPath = join(configDir, "non-live-config.json");
    writeFileSync(liveConfigPath, JSON.stringify({ approvalPolicy: "required_for_elevated", worktreeRoot, liveExecutionEnabled: true }));
    writeFileSync(nonLiveConfigPath, JSON.stringify({ approvalPolicy: "required_for_elevated", worktreeRoot, liveExecutionEnabled: false }));

    // Warm the sandbox base image here too (this test file may run in a
    // separate worker/process from sandbox-docker-backend.test.ts, so
    // its own image warm-up cannot be relied on) -- same reasoning and
    // same generous hook-only timeout as that file's own beforeAll.
    if (dockerAvailable) {
      const warmWorktree = makeTempDir("aiqt-live-warm-worktree-");
      const warmOutput = makeTempDir("aiqt-live-warm-output-");
      const warm = backend.create({
        runId: "warm",
        filesystemPolicy: { worktreeMount: { hostPath: warmWorktree, sandboxPath: "/workspace", mode: "read_write" }, readOnlyMounts: [], isolatedOutputDirectory: warmOutput },
        environmentPolicy: { allowedVariableNames: [] },
        networkPolicy: { mode: "denied", approval: null },
        processPolicy: { processCountLimit: 8, gracefulStopTimeoutSeconds: 5, forceTerminationTimeoutSeconds: 10 },
        resourcePolicy: { maxWallClockSeconds: 60, maxCpuSeconds: 60, maxMemoryBytes: 128 * 1024 * 1024, maxDiskWriteBytes: 10 * 1024 * 1024, maxProcessCount: 8, maxCommandCount: 5, maxOutputBytes: 65536, maxRetryCount: 0 },
      });
      if (warm.ok && warm.handle) backend.destroy(warm.handle);
      removeDir(warmWorktree);
      removeDir(warmOutput);
    }
  }, 120_000);

  const ctx = () => contextFor(process.cwd());

  async function classifyAndStart(issueId: string, configPath: string, extra: Record<string, unknown> = {}) {
    const classifyResult = await runAutonomousClassify(ctx(), {
      repository: targetRepo!,
      baseRef: "HEAD",
      issueId,
      objective: "rename the readme",
      acceptanceCriterion: ["renamed"],
      validationAvailable: true,
      targetedValidationCommand: ["git status"],
      evidenceDir: evidenceDir!,
      configPath,
      ...extra,
    });
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = runAutonomousRun(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath });
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;
    return { runId, requestId };
  }

  async function importLive(runId: string, requestId: string, commandsProposed: { command: string; args: string[] }[], configPath: string) {
    const responsePath = join(makeTempDir("aiqt-live-response-"), "response.json");
    writeFileSync(responsePath, JSON.stringify({ requestId, providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed }));
    return runAutonomousAgentImport(ctx(), { run: runId, fromFile: responsePath, evidenceDir: evidenceDir!, configPath, live: true });
  }

  it("--live is refused before any Docker check when liveExecutionEnabled is false (operator opt-in gate)", async () => {
    const { runId, requestId } = await classifyAndStart("LIVE-GATE", nonLiveConfigPath!);
    const result = await importLive(runId, requestId, [{ command: "echo", args: ["hi"] }], nonLiveConfigPath!);
    expect(result.status).toBe("blocked");
    expect(result.summary).toMatch(/liveExecutionEnabled/);
  });

  it("a successful live run: real sandbox execution, real evidence, real worktree/branch cleanup, default branch untouched", async () => {
    const branchBefore = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim();

    const { runId, requestId } = await classifyAndStart("LIVE-PASS", liveConfigPath!);
    const result = await importLive(
      runId,
      requestId,
      [
        { command: "git", args: ["mv", "README.md", "README2.md"] },
        { command: "git", args: ["commit", "-m", "rename readme"] },
      ],
      liveConfigPath!,
    );

    expect(result.status).toBe("passed");
    const evidence = result.data as { commandsExecuted: string[]; filesChanged: string[]; cleanupStatus: string; terminationReason: string };
    expect(evidence.commandsExecuted.length).toBeGreaterThan(0);
    expect(evidence.terminationReason).toBe("completed");
    expect(evidence.cleanupStatus).toBe("cleaned");

    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    expect(loaded.record.status).toBe("completed");
    expect(loaded.record.sandboxEvidence).not.toBeNull();
    expect(loaded.record.sandboxContainerId).not.toBeNull(); // reference preserved for audit, even though the container itself is gone

    // Real proof: the target repo's own worktree list is back to just the main one, and the default branch/HEAD are untouched.
    const worktreeListing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: targetRepo!, encoding: "utf8" });
    const worktreeLines = worktreeListing.match(/^worktree .+$/gm) ?? [];
    expect(worktreeLines).toHaveLength(1);
    const branchAfter = execFileSync("git", ["branch", "--show-current"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRepo!, encoding: "utf8" }).trim();
    expect(branchAfter).toBe(branchBefore);
    expect(headAfter).toBe(headBefore);
  });

  it("a live run with no targeted validation commands reports validation_failed, never a bare pass (no pass without validation)", async () => {
    // classifyAndStart's own default supplies targetedValidationCommand:
    // ["git status"] -- classify directly here instead, to guarantee a
    // genuinely empty targetedValidationCommands list.
    const classifyResult = await runAutonomousClassify(ctx(), {
      repository: targetRepo!,
      baseRef: "HEAD",
      issueId: "LIVE-NOVALIDATION",
      objective: "rename the readme",
      acceptanceCriterion: ["renamed"],
      validationAvailable: true,
      evidenceDir: evidenceDir!,
      configPath: liveConfigPath!,
    });
    const runId = (classifyResult.data as { runId: string }).runId;
    const runResult = runAutonomousRun(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: liveConfigPath! });
    const requestId = (runResult.data as { agentRequestId: string }).agentRequestId;

    const result = await importLive(runId, requestId, [{ command: "git", args: ["mv", "README.md", "README2.md"] }], liveConfigPath!);
    expect(result.status).toBe("failed");
    const evidence = result.data as { terminationReason: string };
    expect(evidence.terminationReason).toBe("completed");
  });

  it("a destructive proposed command is denied by policy before it ever runs inside the sandbox", async () => {
    const { runId, requestId } = await classifyAndStart("LIVE-DENIED", liveConfigPath!);
    const result = await importLive(runId, requestId, [{ command: "rm", args: ["-rf", "."] }], liveConfigPath!);
    expect(result.status).toBe("blocked");
  });

  it("crash recovery: a run record with a sandboxContainerId but no confirmed cleanup causes `aiqt autonomous cleanup` to really destroy the orphaned container before deleting the record", async () => {
    const { runId, requestId } = await classifyAndStart("LIVE-CRASH", liveConfigPath!);

    // Simulate AIQT crashing between "container created, id persisted"
    // and "cleanup() ever ran" by creating a REAL orphaned container
    // directly, then hand-writing it onto a cancelled (terminal) run
    // record -- exactly the shape prepareLiveSandbox would have left
    // behind if the process had died right after persisting the id.
    const orphanWorktree = makeTempDir("aiqt-live-orphan-worktree-");
    const orphanOutput = makeTempDir("aiqt-live-orphan-output-");
    const created = backend.create({
      runId,
      filesystemPolicy: { worktreeMount: { hostPath: orphanWorktree, sandboxPath: "/workspace", mode: "read_write" }, readOnlyMounts: [], isolatedOutputDirectory: orphanOutput },
      environmentPolicy: { allowedVariableNames: [] },
      networkPolicy: { mode: "denied", approval: null },
      processPolicy: { processCountLimit: 8, gracefulStopTimeoutSeconds: 5, forceTerminationTimeoutSeconds: 10 },
      resourcePolicy: { maxWallClockSeconds: 60, maxCpuSeconds: 60, maxMemoryBytes: 128 * 1024 * 1024, maxDiskWriteBytes: 10 * 1024 * 1024, maxProcessCount: 8, maxCommandCount: 5, maxOutputBytes: 65536, maxRetryCount: 0 },
    });
    expect(created.ok).toBe(true);

    const loaded = loadAutonomousRunRecord(runId, evidenceDir!);
    if (!loaded.ok) throw new Error("run record unexpectedly missing");
    saveAutonomousRunRecord({ ...loaded.record, status: "cancelled", sandboxContainerId: created.handle!.sandboxId, sandboxEvidence: null }, evidenceDir!);

    const cleanupResult = runAutonomousCleanup(ctx(), { run: runId, evidenceDir: evidenceDir!, configPath: liveConfigPath! });
    expect(cleanupResult.status).toBe("passed");

    // Real proof: the container is really gone.
    const inspectFails = (() => {
      try {
        execFileSync("docker", ["inspect", created.handle!.sandboxId], { encoding: "utf8" });
        return false;
      } catch {
        return true;
      }
    })();
    expect(inspectFails).toBe(true);

    removeDir(orphanWorktree);
    removeDir(orphanOutput);
    void requestId;
  });
});
