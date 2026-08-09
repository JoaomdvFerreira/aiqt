import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { BUILT_CLI_ENTRY } from "../cli-runner.js";

// Every test here drives the real CLI through 2-4 tsx subprocess spawns
// (each paying Node startup + on-the-fly TS transpile with no build cache)
// plus real `git commit` subprocesses. Measured isolated runtime on this
// repo's fastest available Node runtime is already 3.7-6.2s; under CI's
// Node 22 leg with full-suite concurrent load the busiest tests
// (4+ subprocess calls) exceed the 5000ms default. This is inherent
// subprocess-spawn cost, not product or test-setup inefficiency -- see
// docs/engineering/m30-correction-node22-integration-timeouts.md.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixturesDir = join(repoRoot, "tests", "fixtures", "claude-code");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BUILT_CLI_ENTRY, ...args], { cwd, encoding: "utf8" });
}

const T1 = "2026-01-01T00:00:00.000Z";

function initGitRepo(dir: string): void {
  initGitFixtureRepo(dir);
}

function commitAiqtState(dir: string, message = "aiqt state"): void {
  execFileSync("git", ["add", ".aiqt"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: dir });
}

function seedInProgressWorkUnitWithPacket(dir: string): void {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.workGraph.workUnits.push({
    id: "WU001",
    milestoneId: "M001",
    title: "T",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["true"],
    status: "in_progress",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
    executionMetadata: { workspaceAssignment: { mode: "none", access: "read_only" }, parallelPolicy: { mode: "serialized", resourceClaims: [] } },
  });
  state.workGraph.milestones.push({ id: "M001", title: "M", objective: "O", status: "in_progress", workUnitIds: ["WU001"] });
  state.currentWorkUnitId = "WU001";
  state.currentMilestoneId = "M001";
  state.lastAgentPacket = {
    id: "PKT-001",
    workUnitId: "WU001",
    milestoneId: "M001",
    createdAt: T1,
    format: "markdown",
    contentHash: "sha256:" + "a".repeat(64),
    sourceCommand: "aiqt next",
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/** Rewrites a fixture's fixed session_id to match a freshly generated external session UUID. */
function fixtureWithSessionId(fixtureName: string, externalSessionId: string, outPath: string): void {
  const text = readFileSync(join(fixturesDir, fixtureName), "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const rewritten = lines
    .map((l) => {
      const obj = JSON.parse(l);
      if (obj.session_id) obj.session_id = externalSessionId;
      return JSON.stringify(obj);
    })
    .join("\n");
  writeFileSync(outPath, rewritten + "\n");
}

function requestNew(dir: string) {
  const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
  expect(res.status).toBe(0);
  return JSON.parse(res.stdout).data as { request: { id: string; executionSessionId: string; externalSessionId: string } };
}

describe("M27-WU04: aiqt execution adapter claude-code import", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a full start-request -> import (success) lifecycle: iteration completed, session paused, checkpoint still required", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");

    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);

    const importRes = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir);
    expect(importRes.status).toBe(0);
    const importData = JSON.parse(importRes.stdout).data;
    expect(importData.resultClass).toBe("success");

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const session = state.executionSessions[0];
    expect(session.status).toBe("paused");
    expect(session.iterations).toHaveLength(1);
    expect(session.iterations[0].status).toBe("completed");
    expect(state.executionAdapterRequests[0].status).toBe("imported");
    expect(state.executionAdapterRequests[0].invocationSummary.resultClass).toBe("success");

    // Provider success never completes the Work Unit or bypasses checkpoint.
    expect(state.currentWorkUnitId).toBe("WU001");
    expect(state.checkpoints).toHaveLength(0);

    // No raw fixture text leaked into state.json.
    const stateText = JSON.stringify(state);
    expect(stateText).not.toMatch(/Synthetic placeholder/);
  });

  it("re-importing the exact same bytes is an idempotent no-op (exit 0, no new mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);

    expect(runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const secondRes = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir);
    expect(secondRes.status).toBe(0);
    expect(JSON.parse(secondRes.stdout).data.outcome).toBe("no_op");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("re-importing a different source for an already-imported request is a digest conflict (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);
    expect(runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const otherOutputPath = join(dir, "other-output.jsonl");
    fixtureWithSessionId("02-success-resumed-invocation.jsonl", request.externalSessionId, otherOutputPath);
    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", otherOutputPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("ADAPTER-IMPORT-DIGEST-CONFLICT");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("wrong external session ID is rejected (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    // Deliberately do NOT rewrite the session_id -- fixture uses its own fixed UUID, which will not match.
    const outputPath = join(fixturesDir, "01-success-first-invocation.jsonl");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("ADAPTER-IMPORT-SESSION-ID-MISMATCH");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("malformed/truncated output is rejected atomically (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("07-malformed-truncated.jsonl", request.externalSessionId, outputPath);

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("ADAPTER-IMPORT-PARSE-REJECTED");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("mixed-session output is rejected atomically (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    copyFileSync(join(fixturesDir, "08-mixed-session.jsonl"), outputPath);

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("--preview validates and writes nothing", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).summary).toContain("Preview");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("a limited (max-turn) result blocks the session, and a subsequent resume-request/import completes the lifecycle", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const limitedOutput = join(dir, "limited-output.jsonl");
    fixtureWithSessionId("05-max-turn-budget-stop.jsonl", request.externalSessionId, limitedOutput);
    const first = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", limitedOutput, "--as-of", T1, "--json"], dir);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).data.resultClass).toBe("limited");
    commitAiqtState(dir, "after limited import");

    let state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("blocked");

    const resumeRes = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--resume-session", request.executionSessionId, "--as-of", T1, "--json"], dir);
    expect(resumeRes.status).toBe(0);
    const resumeRequest = JSON.parse(resumeRes.stdout).data.request;
    commitAiqtState(dir, "after resume request");

    const successOutput = join(dir, "success-output.jsonl");
    fixtureWithSessionId("02-success-resumed-invocation.jsonl", request.externalSessionId, successOutput);
    const second = runCli(["execution", "adapter", "claude-code", "import", "--request", resumeRequest.id, "--from-file", successOutput, "--as-of", T1, "--json"], dir);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).data.resultClass).toBe("success");

    state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("paused");
    expect(state.executionSessions[0].iterations).toHaveLength(2);
  });

  it("next cancel remains blocked by any adapter-derived session history, terminal or not (corrected M26 behavior preserved)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);
    expect(runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const cancelRes = runCli(["next", "cancel", "--json"], dir);
    expect(cancelRes.status).toBe(2);
    expect(JSON.parse(cancelRes.stdout).blockingIssues[0].id).toBe("NEXT-CANCEL-EXECUTION-SESSION-EXISTS");
  });

  it("aiqt execution adapter claude-code status reports request counts and health without probing anything external", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);
    expect(runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir).status).toBe(0);

    const statusRes = runCli(["execution", "adapter", "claude-code", "status", "--json"], dir);
    expect(statusRes.status).toBe(0);
    const data = JSON.parse(statusRes.stdout).data;
    expect(data.requestCountsByStatus.imported).toBe(1);
    expect(data.health).toBe("healthy");
    expect(data.adapterId).toBe("claude-code-stream-json@1");
  });

  it("aiqt review surfaces no adapter findings for a clean successful import", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);
    expect(runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const reviewRes = runCli(["review", "--json"], dir);
    expect(reviewRes.status === 0 || reviewRes.status === 1).toBe(true);
    const parsed = JSON.parse(reviewRes.status === 0 ? reviewRes.stdout : reviewRes.stderr);
    const adapterFindings = parsed.data.findings.filter((f: { findingKey: string }) => f.findingKey.startsWith("execution-adapter:"));
    expect(adapterFindings).toHaveLength(0);
  });
});
