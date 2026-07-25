import { describe, it, expect, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
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

function requestNew(dir: string, asOf = T1) {
  const res = runCli(["execution", "external", "request", "WU001", "--as-of", asOf, "--json"], dir);
  expect(res.status).toBe(0);
  return JSON.parse(res.stdout).data as { request: { id: string; executionSessionId: string; sessionClientKey: string } };
}

function genericResult(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-external-execution-result@1",
    requestId: "",
    executionSessionId: "",
    agent: { providerId: "openai/codex" },
    resultClass: "success",
    summary: "Implemented the change.",
    continuation: { recommended: false },
    validationClaims: [{ command: "npm test", status: "passed", trust: "self_reported" }],
    commitRefs: [{ sha: "abc1234", message: "Implement" }],
    evidenceRefs: [],
    ...overrides,
  };
}

describe("M27R-WU04: aiqt execution external import", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a full request -> import (success) lifecycle: iteration completed, session paused, agent identity recorded, checkpoint still required", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");

    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId })));

    const importRes = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
    expect(importRes.status).toBe(0);
    const importData = JSON.parse(importRes.stdout).data;
    expect(importData.resultClass).toBe("success");

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const session = state.executionSessions[0];
    expect(session.status).toBe("paused");
    expect(session.iterations).toHaveLength(1);
    expect(session.iterations[0].status).toBe("completed");
    expect(state.executionAdapterRequests[0].status).toBe("imported");
    expect(state.executionAdapterRequests[0].importedAgent).toEqual({ providerId: "openai/codex" });
    expect(state.executionAdapterRequests[0].importedIterationId).toBeTruthy();

    expect(state.currentWorkUnitId).toBe("WU001");
    expect(state.checkpoints).toHaveLength(0);
  });

  it("re-importing the exact same bytes is an idempotent no-op", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId })));

    expect(runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const second = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).data.outcome).toBe("no_op");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("re-importing different bytes for an already-imported request is a digest conflict (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId })));
    expect(runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const otherPath = join(dir, "other-result.json");
    writeFileSync(otherPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId, summary: "A different summary." })));
    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "import", "--request", request.id, "--from-file", otherPath, "--as-of", T2, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stderr).blockingIssues[0].id).toBe("EXTERNAL-IMPORT-DIGEST-CONFLICT");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("a requestId/session mismatch is rejected atomically (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: "WRONG-REQUEST-ID", executionSessionId: request.executionSessionId })));

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stderr).blockingIssues[0].id).toBe("EXTERNAL-IMPORT-REQUEST-MISMATCH");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("malformed JSON is rejected atomically (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, "{ not valid json");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir);
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
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId })));

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).summary).toContain("Preview");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("agent switching: different agents contribute separate iterations to the same generic M26 session", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const firstResultPath = join(dir, "result1.json");
    writeFileSync(firstResultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId, agent: { providerId: "openai/codex" }, resultClass: "limited" })));
    const first = runCli(["execution", "external", "import", "--request", request.id, "--from-file", firstResultPath, "--as-of", T2, "--json"], dir);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).data.resultClass).toBe("limited");
    commitAiqtState(dir, "after first import");

    let state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("blocked");

    const resumeRes = runCli(["execution", "external", "request", "WU001", "--resume-session", request.executionSessionId, "--as-of", T2, "--json"], dir);
    expect(resumeRes.status).toBe(0);
    const resumeRequest = JSON.parse(resumeRes.stdout).data.request;
    commitAiqtState(dir, "after resume request");

    const secondResultPath = join(dir, "result2.json");
    writeFileSync(secondResultPath, JSON.stringify(genericResult({ requestId: resumeRequest.id, executionSessionId: request.executionSessionId, agent: { providerId: "anthropic/claude-code" }, resultClass: "success" })));
    const second = runCli(["execution", "external", "import", "--request", resumeRequest.id, "--from-file", secondResultPath, "--as-of", T2, "--json"], dir);
    expect(second.status).toBe(0);

    state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions).toHaveLength(1);
    expect(state.executionSessions[0].iterations).toHaveLength(2);
    expect(state.executionSessions[0].status).toBe("paused");
    expect(state.executionAdapterRequests[0].importedAgent.providerId).toBe("openai/codex");
    expect(state.executionAdapterRequests[1].importedAgent.providerId).toBe("anthropic/claude-code");
  });

  it("next cancel remains blocked by generic-path session history, terminal or not (corrected M26 behavior preserved)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId })));
    expect(runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const cancelRes = runCli(["next", "cancel", "--json"], dir);
    expect(cancelRes.status).toBe(2);
    expect(JSON.parse(cancelRes.stderr).blockingIssues[0].id).toBe("NEXT-CANCEL-EXECUTION-SESSION-EXISTS");
  });

  it("aiqt execution external status reports request counts, generic session counts, and next action", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId })));
    expect(runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir).status).toBe(0);

    const statusRes = runCli(["execution", "external", "status", "--json"], dir);
    expect(statusRes.status).toBe(0);
    const data = JSON.parse(statusRes.stdout).data;
    expect(data.requestCountsByStatus.imported).toBe(1);
    expect(data.genericSessionCount).toBe(1);
    expect(data.legacyProviderSpecificSessionCount).toBe(0);
  });

  it("aiqt review surfaces no adapter findings for a clean generic import", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const { request } = requestNew(dir);
    commitAiqtState(dir, "after request");
    const resultPath = join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify(genericResult({ requestId: request.id, executionSessionId: request.executionSessionId })));
    expect(runCli(["execution", "external", "import", "--request", request.id, "--from-file", resultPath, "--as-of", T2, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const reviewRes = runCli(["review", "--json"], dir);
    expect(reviewRes.status === 0 || reviewRes.status === 1).toBe(true);
    const parsed = JSON.parse(reviewRes.status === 0 ? reviewRes.stdout : reviewRes.stderr);
    const adapterFindings = parsed.data.findings.filter((f: { findingKey: string }) => f.findingKey.startsWith("execution-adapter:"));
    expect(adapterFindings).toHaveLength(0);
  });
});
