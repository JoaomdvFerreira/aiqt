import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { BUILT_CLI_ENTRY } from "../cli-runner.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });


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
    objective: "Implement the feature.",
    scope: ["src/feature.ts"],
    outOfScope: ["src/unrelated.ts"],
    acceptanceCriteria: ["Feature works"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["npm test"],
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

const GENERIC_KEY_RE = /^external\/[0-9a-f-]{36}$/i;

describe("M27R-WU03: aiqt execution external request", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("generates a start request with an AIQT-generated external/<uuid> sessionClientKey, providerId external/agent, and a bundle on --output", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const outDir = join(dir, "bundle");
    const res = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--output", outDir, "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.outcome).toBe("start");
    expect(GENERIC_KEY_RE.test(parsed.data.request.sessionClientKey)).toBe(true);
    expect(parsed.data.request.adapterId).toBe("generic-json@1");

    for (const file of ["request.json", "instructions.md", "result.example.json", "result.schema.json"]) {
      expect(existsSync(join(outDir, file)), file).toBe(true);
    }
    const requestJson = JSON.parse(readFileSync(join(outDir, "request.json"), "utf8"));
    expect(requestJson.protocolVersion).toBe("aiqt-external-execution-request@1");
    expect(requestJson.packet.scope).toEqual(["src/feature.ts"]);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions).toHaveLength(1);
    expect(state.executionSessions[0].provider.providerId).toBe("external/agent");
    expect(state.executionSessions[0].sessionClientKey).toBe(parsed.data.request.sessionClientKey);
    expect(state.executionAdapterRequests).toHaveLength(1);
  });

  it("--preview writes nothing", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("a plain retry (same active request still open) reuses the exact same request/session identity -- no second M26 session", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const first = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const firstData = JSON.parse(first.stdout).data;
    commitAiqtState(dir, "after first request");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const second = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(second.status).toBe(0);
    const secondData = JSON.parse(second.stdout).data;
    expect(secondData.outcome).toBe("retry");
    expect(secondData.request.id).toBe(firstData.request.id);
    expect(secondData.request.sessionClientKey).toBe(firstData.request.sessionClientKey);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("an independent attempt after prior terminal history receives a distinct sessionClientKey and a new M26 session", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const first = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const firstData = JSON.parse(first.stdout).data;

    // Force the first session to a terminal state directly (simulating a
    // failed/cancelled attempt), so a second plain `request` call is a
    // genuinely independent new attempt, not a retry.
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionSessions[0].status = "cancelled";
    state.executionSessions[0].terminalAt = T1;
    state.executionSessions[0].statusTransitions.push({ fromStatus: "planned", toStatus: "cancelled", reason: "test-injected cancellation", at: T1 });
    state.executionAdapterRequests[0].status = "expired";
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    commitAiqtState(dir, "after forced cancellation");

    const second = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(second.status).toBe(0);
    const secondData = JSON.parse(second.stdout).data;
    expect(secondData.outcome).toBe("start");
    expect(secondData.request.sessionClientKey).not.toBe(firstData.request.sessionClientKey);
    expect(secondData.request.executionSessionId).not.toBe(firstData.request.executionSessionId);

    const finalState = JSON.parse(readFileSync(statePath, "utf8"));
    expect(finalState.executionSessions).toHaveLength(2);
  });

  it("--resume-session reuses the session's persisted sessionClientKey and increments requestSequence", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const first = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const firstData = JSON.parse(first.stdout).data;

    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionAdapterRequests[0].status = "imported";
    state.executionAdapterRequests[0].importedAt = T1;
    state.executionAdapterRequests[0].importedSourceDigest = "sha256:" + "b".repeat(64);
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    commitAiqtState(dir, "after first request (simulated import)");

    const resumeRes = runCli(["execution", "external", "request", "WU001", "--resume-session", firstData.request.executionSessionId, "--as-of", T1, "--json"], dir);
    expect(resumeRes.status).toBe(0);
    const resumeData = JSON.parse(resumeRes.stdout).data;
    expect(resumeData.outcome).toBe("resume");
    expect(resumeData.request.sessionClientKey).toBe(firstData.request.sessionClientKey);
    expect(resumeData.request.requestSequence).toBe(2);

    const finalState = JSON.parse(readFileSync(statePath, "utf8"));
    expect(finalState.executionSessions).toHaveLength(1);
  });

  it("a second start request while the session is non-terminal (no open active request) is blocked, exit 2, zero mutation", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    // Simulate: request already imported (so it's no longer "active"),
    // but the session itself is still non-terminal ("paused").
    state.executionAdapterRequests[0].status = "imported";
    state.executionAdapterRequests[0].importedAt = T1;
    state.executionAdapterRequests[0].importedSourceDigest = "sha256:" + "b".repeat(64);
    state.executionSessions[0].status = "paused";
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    commitAiqtState(dir, "after simulated import");

    const stateBefore = readFileSync(statePath, "utf8");
    const res = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EXTERNAL-REQUEST-NON-TERMINAL-SESSION-EXISTS");
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("aiqt execution external example prints a static sample and touches no state", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "example"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.protocolVersion).toBe("aiqt-external-execution-request@1");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });
});
