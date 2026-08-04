import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
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

/** Seeds a state.json exactly as a pre-M27R Claude session would have looked: deterministic sessionClientKey, providerId anthropic/claude-code, no sessionClientKey/importedAgent fields on the request. */
function seedLegacyClaudeSession(dir: string) {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const sessionId = "sha256:" + "1".repeat(64);
  state.executionSessions = [
    {
      id: sessionId,
      protocolVersion: "long-running-execution-protocol@1",
      sessionClientKey: "claude-code-stream-json@1:WU001:PKT-001",
      provider: { providerId: "anthropic/claude-code", externalSessionId: "11111111-1111-4111-8111-111111111111" },
      workUnitId: "WU001",
      packetId: "PKT-001",
      workspaceRef: { mode: "none" },
      status: "paused",
      budgetState: "not_configured",
      iterations: [
        {
          id: "XI-001",
          providerIterationKey: "legacy-req-1",
          sequence: 1,
          status: "completed",
          startedAt: T1,
          finishedAt: T1,
          commitRefs: [],
          evidenceRefs: [],
        },
      ],
      decisions: [],
      rollbackRecords: [],
      commitRefs: [],
      evidenceRefs: [],
      statusTransitions: [
        { fromStatus: "planned", toStatus: "running", reason: "legacy start", at: T1 },
        { fromStatus: "running", toStatus: "paused", reason: "provider result: success", at: T1 },
      ],
      eventReceipts: [],
      createdAt: T1,
      updatedAt: T1,
      lastActivityAt: T1,
    },
  ];
  state.executionAdapterRequests = [
    {
      id: "sha256:" + "2".repeat(64),
      adapterId: "claude-code-stream-json@1",
      executionSessionId: sessionId,
      workUnitId: "WU001",
      packetId: "PKT-001",
      workspaceRef: { mode: "none" },
      requestSequence: 1,
      externalSessionId: "11111111-1111-4111-8111-111111111111",
      mode: "start",
      status: "imported",
      requestDigest: "sha256:" + "3".repeat(64),
      importedSourceDigest: "sha256:" + "4".repeat(64),
      providerVersionConstraint: "claude-code>=1.0.0 <2.0.0",
      createdAt: T1,
      expiresAt: "2026-01-02T00:00:00.000Z",
      importedAt: T1,
    },
  ];
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return sessionId;
}

describe("M27R-WU05: legacy Claude session compatibility and generic identity space", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a new Claude adapter request (no --resume-session) uses providerId external/agent and an AIQT-generated external/<uuid> sessionClientKey, not the old deterministic scheme", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const session = state.executionSessions[0];
    expect(session.provider.providerId).toBe("external/agent");
    expect(session.sessionClientKey).toMatch(/^external\/[0-9a-f-]{36}$/i);
    expect(session.sessionClientKey).not.toBe("claude-code-stream-json@1:WU001:PKT-001");
    // Claude's own native UUID is still generated and recorded as adapter metadata.
    expect(session.provider.externalSessionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("a pre-M27R legacy anthropic/claude-code session remains valid, resumable by the Claude adapter, and is reported as legacy_provider_specific_session", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const sessionId = seedLegacyClaudeSession(dir);
    commitAiqtState(dir);

    const resumeRes = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--resume-session", sessionId, "--as-of", T1, "--json"], dir);
    expect(resumeRes.status).toBe(0);
    const data = JSON.parse(resumeRes.stdout).data;
    expect(data.request.executionSessionId).toBe(sessionId);
    expect(data.request.sessionClientKey).toBe("claude-code-stream-json@1:WU001:PKT-001");
    // Claude already operated this session natively -- its own UUID is reused, so the command template says --resume.
    expect(data.requestPackage.commandTemplate.arguments).toContain("--resume");
    expect(data.requestPackage.commandTemplate.arguments).toContain("11111111-1111-4111-8111-111111111111");

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions).toHaveLength(1);

    const statusRes = runCli(["execution", "adapter", "claude-code", "status", "--session", sessionId, "--json"], dir);
    expect(statusRes.status).toBe(0);
    const statusData = JSON.parse(statusRes.stdout).data;
    const legacyRequest = statusData.requests.find((r: { id: string }) => r.id.includes("2"));
    expect(legacyRequest.sessionKind).toBe("legacy_provider_specific_session");
  });

  it("the generic path (aiqt execution external request) cannot resume a legacy provider-specific session", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const sessionId = seedLegacyClaudeSession(dir);
    commitAiqtState(dir);

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "external", "request", "WU001", "--resume-session", sessionId, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EXTERNAL-REQUEST-LEGACY-SESSION-NOT-SUPPORTED");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("a Claude adapter resume can target an existing external/agent session created by the generic path (cross-adapter continuity)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const genericRes = runCli(["execution", "external", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(genericRes.status).toBe(0);
    const genericData = JSON.parse(genericRes.stdout).data;
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionAdapterRequests[0].status = "imported";
    state.executionAdapterRequests[0].importedAt = T1;
    state.executionAdapterRequests[0].importedSourceDigest = "sha256:" + "b".repeat(64);
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    commitAiqtState(dir, "after generic request (simulated import)");

    const claudeResumeRes = runCli(
      ["execution", "adapter", "claude-code", "request", "WU001", "--resume-session", genericData.request.executionSessionId, "--as-of", T1, "--json"],
      dir,
    );
    expect(claudeResumeRes.status).toBe(0);
    const claudeData = JSON.parse(claudeResumeRes.stdout).data;
    expect(claudeData.request.sessionClientKey).toBe(genericData.request.sessionClientKey);
    // Claude has no prior native transcript for this session -- it starts fresh natively, even though this is an M26-level resume.
    expect(claudeData.requestPackage.commandTemplate.arguments).toContain("--session-id");

    const finalState = JSON.parse(readFileSync(statePath, "utf8"));
    expect(finalState.executionSessions).toHaveLength(1);
    expect(finalState.executionSessions[0].provider.providerId).toBe("external/agent");
  });
});
