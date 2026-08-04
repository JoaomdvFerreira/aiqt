import { describe, it, expect, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
}

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-01T01:00:00.000Z";

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

function genericResult(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-external-execution-result@1",
    requestId: "",
    executionSessionId: "",
    agent: { providerId: "openai/codex" },
    resultClass: "limited",
    summary: "Partial progress.",
    continuation: { recommended: true, reason: "more work needed" },
    validationClaims: [],
    commitRefs: [],
    evidenceRefs: [],
    ...overrides,
  };
}

function markImported(dir: string, requestIndex: number) {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.executionAdapterRequests[requestIndex].status = "imported";
  state.executionAdapterRequests[requestIndex].importedAt = T1;
  state.executionAdapterRequests[requestIndex].importedSourceDigest = "sha256:" + String(requestIndex).repeat(64).slice(0, 64);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe("M27R-WU06: hardening and disposable-project cross-agent lifecycle", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("three distinct opaque agent IDs contribute three iterations to one generic M26 session (cross-agent continuity at scale)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const agents = ["openai/codex", "anthropic/claude-code", "custom/local-agent"];
    let executionSessionId = "";
    let lastRequestId = "";

    for (let i = 0; i < agents.length; i++) {
      const requestRes =
        i === 0
          ? runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir)
          : runCli(["execution", "external", "request", "WU001", "--resume-session", executionSessionId, "--as-of", T1, "--json"], dir);
      expect(requestRes.status, `request ${i}`).toBe(0);
      const requestData = JSON.parse(requestRes.stdout).data;
      executionSessionId = requestData.request.executionSessionId;
      lastRequestId = requestData.request.id;

      const resultPath = join(dir, `result${i}.json`);
      const isLast = i === agents.length - 1;
      writeFileSync(
        resultPath,
        JSON.stringify(
          genericResult({
            requestId: lastRequestId,
            executionSessionId,
            agent: { providerId: agents[i] },
            resultClass: isLast ? "success" : "limited",
          }),
        ),
      );
      const importRes = runCli(["execution", "external", "import", "--request", lastRequestId, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
      expect(importRes.status, `import ${i}`).toBe(0);
    }

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions).toHaveLength(1);
    expect(state.executionSessions[0].iterations).toHaveLength(3);
    expect(state.executionSessions[0].status).toBe("paused");
    expect(state.executionAdapterRequests).toHaveLength(3);
    const importedAgents = state.executionAdapterRequests.map((r: { importedAgent: { providerId: string } }) => r.importedAgent.providerId);
    expect(importedAgents).toEqual(agents);
  }, 40000);

  it("a runlog-append failure during a generic external request leaves state authoritative; a retry reuses the same identity", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failed = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
      expect(failed.status).toBe(3);
      expect(JSON.parse(failed.stdout).blockingIssues[0].id).toBe("EXTERNAL-REQUEST-RUNLOG-APPEND-FAILED");

      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.executionAdapterRequests).toHaveLength(1);
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      chmodSync(runlogPath, 0o644);
      const retry = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
      expect(retry.status).toBe(0);
      expect(JSON.parse(retry.stdout).data.outcome).toBe("retry");
      const stateAfterRetry = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterRetry.executionAdapterRequests).toHaveLength(1);
      expect(stateAfterRetry.executionSessions).toHaveLength(1);
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  }, 20000);

  it("a runlog-append failure during a generic external import leaves state authoritative; a retry is an idempotent no-op", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const requestRes = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const request = JSON.parse(requestRes.stdout).data.request;
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId, resultClass: "success", continuation: { recommended: false } })));

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failed = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
      expect(failed.status).toBe(3);
      expect(JSON.parse(failed.stdout).blockingIssues[0].id).toBe("EXTERNAL-IMPORT-RUNLOG-APPEND-FAILED");

      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.executionAdapterRequests[0].status).toBe("imported");
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      chmodSync(runlogPath, 0o644);
      const retry = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
      expect(retry.status).toBe(0);
      expect(JSON.parse(retry.stdout).data.outcome).toBe("no_op");
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  }, 20000);

  it("GENERIC_MAX_REQUESTS_PER_SESSION (100) is enforced with zero mutation once reached", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const requestRes = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const request = JSON.parse(requestRes.stdout).data.request;
    markImported(dir, 0);

    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const extra = Array.from({ length: 99 }, (_, i) => ({
      ...state.executionAdapterRequests[0],
      id: `sha256:${(i + 10).toString(16).padStart(64, "0")}`,
      requestSequence: i + 2,
      status: "imported",
      importedAt: T1,
      importedSourceDigest: `sha256:${"e".repeat(64)}`,
    }));
    state.executionAdapterRequests.push(...extra);
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const stateBefore = readFileSync(statePath, "utf8");
    const res = runCli(["execution", "external", "request", "WU001", "--resume-session", request.executionSessionId, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EXTERNAL-REQUEST-SESSION-CAP-REACHED");
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  }, 20000);

  it("a malformed generic result with an unknown/prohibited field is rejected atomically", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const requestRes = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const request = JSON.parse(requestRes.stdout).data.request;
    commitAiqtState(dir, "after request");

    const resultPath = join(dir, "result.json");
    writeFileSync(
      resultPath,
      JSON.stringify({
        ...genericResult({ requestId: request.id, executionSessionId: request.executionSessionId, resultClass: "success" }),
        rawTranscript: "the entire raw conversation transcript...",
      }),
    );
    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EXTERNAL-IMPORT-SCHEMA-INVALID");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  }, 20000);

  it("self-reported validation claims never gain elevated trust in state -- trust is always literally 'self_reported'", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const requestRes = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const request = JSON.parse(requestRes.stdout).data.request;
    commitAiqtState(dir, "after request");

    const resultPath = join(dir, "result.json");
    writeFileSync(
      resultPath,
      JSON.stringify(
        genericResult({
          requestId: request.id,
          executionSessionId: request.executionSessionId,
          resultClass: "success",
          continuation: { recommended: false },
          validationClaims: [{ command: "npm test", status: "passed", trust: "self_reported" }],
        }),
      ),
    );
    expect(runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir).status).toBe(0);

    // Validation claims are not persisted verbatim into M26 state at all
    // (M26 has no validationClaims field) -- the self-reported summary
    // only ever lands as a bounded iteration.resultSummary, never as a
    // "verified" or "platform" trust level anywhere.
    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const stateText = JSON.stringify(state);
    expect(stateText).not.toMatch(/"trust":"verified"/);
    expect(stateText).not.toMatch(/"trust":"platform"/);
    expect(state.checkpoints).toHaveLength(0);
  }, 20000);
});
