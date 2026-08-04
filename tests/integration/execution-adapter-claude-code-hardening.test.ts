import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");
const fixturesDir = join(repoRoot, "tests", "fixtures", "claude-code");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
}

const T1 = "2026-01-01T00:00:00.000Z";

function initGitRepo(dir: string): void {
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: dir });
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

describe("M27-WU05: compatibility, security, and failure hardening", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a runlog-append failure during request leaves state authoritative; a same-shape retry does not duplicate the session/request", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failed = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
      expect(failed.status).toBe(3);
      expect(JSON.parse(failed.stdout).blockingIssues[0].id).toBe("ADAPTER-REQUEST-RUNLOG-APPEND-FAILED");

      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.executionAdapterRequests).toHaveLength(1);
      expect(stateAfterFailure.executionSessions).toHaveLength(1);
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      chmodSync(runlogPath, 0o644);
      // A same-shape retry sees the active (still "requested") request
      // state already wrote; per M27R's retry-reuse semantics this
      // returns the SAME request/session identity (exit 0) rather than
      // blocking -- state remains authoritative and no second
      // session/request is ever created.
      const retry = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
      expect(retry.status).toBe(0);
      expect(JSON.parse(retry.stdout).data.outcome).toBe("retry");
      const stateAfterRetry = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterRetry.executionAdapterRequests).toHaveLength(1);
      expect(stateAfterRetry.executionSessions).toHaveLength(1);
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  });

  it("a runlog-append failure during import leaves state authoritative (request already imported); a retry is an idempotent no-op", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const requestRes = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    const request = JSON.parse(requestRes.stdout).data.request;
    commitAiqtState(dir, "after request");

    const outputPath = join(dir, "output.jsonl");
    fixtureWithSessionId("01-success-first-invocation.jsonl", request.externalSessionId, outputPath);

    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failed = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir);
      expect(failed.status).toBe(3);
      expect(JSON.parse(failed.stdout).blockingIssues[0].id).toBe("ADAPTER-IMPORT-RUNLOG-APPEND-FAILED");

      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.executionAdapterRequests[0].status).toBe("imported");
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      chmodSync(runlogPath, 0o644);
      const retry = runCli(["execution", "adapter", "claude-code", "import", "--request", request.id, "--from-file", outputPath, "--as-of", T1, "--json"], dir);
      expect(retry.status).toBe(0);
      expect(JSON.parse(retry.stdout).data.outcome).toBe("no_op");
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  });

  it("MAX_ADAPTER_REQUESTS_PER_SESSION is enforced (exit 2, zero mutation once reached)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const requestRes = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    const request = JSON.parse(requestRes.stdout).data.request;

    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    // Fabricate 199 more (already-imported, so they never look "active")
    // requests for this session to reach the 200-per-session cap without
    // running 200 real CLI invocations.
    const extra = Array.from({ length: 199 }, (_, i) => ({
      ...state.executionAdapterRequests[0],
      id: `sha256:${(i + 1).toString(16).padStart(64, "0")}`,
      requestSequence: i + 2,
      status: "imported",
      importedAt: T1,
      importedSourceDigest: `sha256:${"b".repeat(64)}`,
    }));
    state.executionAdapterRequests[0].status = "imported";
    state.executionAdapterRequests[0].importedAt = T1;
    state.executionAdapterRequests[0].importedSourceDigest = `sha256:${"c".repeat(64)}`;
    state.executionAdapterRequests.push(...extra);
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const stateBefore = readFileSync(statePath, "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--resume-session", request.executionSessionId, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("ADAPTER-REQUEST-SESSION-CAP-REACHED");
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("a legacy pre-M27 state.json (no executionAdapterRequests field at all) remains valid for status and review, and is never materialized by either", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect("executionAdapterRequests" in state).toBe(false);

    const statusRes = runCli(["execution", "adapter", "claude-code", "status", "--json"], dir);
    expect(statusRes.status).toBe(0);
    expect(JSON.parse(statusRes.stdout).data.requestCountsByStatus.requested).toBe(0);

    const reviewRes = runCli(["review", "--json"], dir);
    expect(reviewRes.status === 0 || reviewRes.status === 1).toBe(true);

    // Read-only commands never materialize the optional field.
    const stateAfter = JSON.parse(readFileSync(statePath, "utf8"));
    expect("executionAdapterRequests" in stateAfter).toBe(false);
  });

  it("an adapter-opened session that later becomes stale still blocks packet cancel (M27 does not configure budgets/staleness itself -- M26 stale detection and the corrected packet-cancel safeguard apply unchanged)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    expect(runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after request");

    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionSessions[0].status = "stale";
    state.executionSessions[0].statusTransitions.push({ fromStatus: "planned", toStatus: "stale", reason: "test-injected staleness", at: T1 });
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const cancelRes = runCli(["next", "cancel", "--json"], dir);
    expect(cancelRes.status).toBe(2);
    expect(JSON.parse(cancelRes.stdout).blockingIssues[0].id).toBe("NEXT-CANCEL-EXECUTION-SESSION-EXISTS");
  });
});
