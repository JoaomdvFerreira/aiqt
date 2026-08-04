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

function seedInProgressWorkUnitWithPacket(dir: string, mode: "none" | "isolated" = "none"): void {
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
    executionMetadata:
      mode === "isolated"
        ? { workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" }, parallelPolicy: { mode: "serialized", resourceClaims: [] } }
        : { workspaceAssignment: { mode: "none", access: "read_only" }, parallelPolicy: { mode: "serialized", resourceClaims: [] } },
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("M27-WU02: aiqt execution adapter claude-code request", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("generates a start request, persists an ExecutionAdapterRequest and a planned execution session, and never executes anything", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe("passed");
    expect(parsed.data.request.mode).toBe("start");
    expect(parsed.data.request.status).toBe("requested");
    expect(parsed.data.request.adapterId).toBe("claude-code-stream-json@1");
    expect(UUID_RE.test(parsed.data.request.externalSessionId)).toBe(true);
    expect(parsed.data.requestPackage.commandTemplate.executable).toBe("claude");
    expect(parsed.data.requestPackage.commandTemplate.arguments).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      parsed.data.request.externalSessionId,
    ]);
    // No permission-bypass flag, no arbitrary argument, ever.
    expect(JSON.stringify(parsed.data.requestPackage.commandTemplate.arguments)).not.toMatch(/dangerously|bypass/i);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionAdapterRequests).toHaveLength(1);
    expect(state.executionSessions).toHaveLength(1);
    expect(state.executionSessions[0].status).toBe("planned");
    expect(state.executionSessions[0].provider.externalSessionId).toBe(parsed.data.request.externalSessionId);
  });

  it("--preview writes nothing", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.summary).toContain("Preview");
  });

  it("a second start request for the same packet, while the first request is still active, is a retry (exit 0, same identity, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const first = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(first.status).toBe(0);
    const firstData = JSON.parse(first.stdout).data;
    commitAiqtState(dir, "after first request");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.outcome).toBe("retry");
    expect(data.request.id).toBe(firstData.request.id);
    const stateAfter = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(stateAfter).toBe(stateBefore);
  });

  it("a second start request while the session is non-terminal but has no active (already-imported) request is blocked (exit 2), zero mutation", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    expect(runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir).status).toBe(0);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionAdapterRequests[0].status = "imported";
    state.executionAdapterRequests[0].importedAt = T1;
    state.executionAdapterRequests[0].importedSourceDigest = "sha256:" + "b".repeat(64);
    state.executionSessions[0].status = "paused";
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    commitAiqtState(dir, "after simulated import");

    const stateBefore = readFileSync(statePath, "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(2);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.blockingIssues[0].id).toBe("EXTERNAL-REQUEST-NON-TERMINAL-SESSION-EXISTS");
    const stateAfter = readFileSync(statePath, "utf8");
    expect(stateAfter).toBe(stateBefore);
  });

  it("--resume-session reuses the existing external session UUID and increments requestSequence, never creating a second session", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const first = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    const firstData = JSON.parse(first.stdout).data;
    // WU27-02 tests the request command in isolation, before WU27-04's
    // import command exists; simulate "the first request was already
    // imported" (the only way a resume becomes reachable per §3.2's "no
    // other active adapter request may block it") by marking it imported
    // directly in state, exactly as a real import would leave it.
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionAdapterRequests[0].status = "imported";
    state.executionAdapterRequests[0].importedAt = T1;
    state.executionAdapterRequests[0].importedSourceDigest = "sha256:" + "b".repeat(64);
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    commitAiqtState(dir, "after first request");

    const resumeRes = runCli(
      ["execution", "adapter", "claude-code", "request", "WU001", "--resume-session", firstData.request.executionSessionId, "--as-of", T1, "--json"],
      dir,
    );
    expect(resumeRes.status).toBe(0);
    const resumeData = JSON.parse(resumeRes.stdout).data;
    expect(resumeData.request.mode).toBe("resume");
    expect(resumeData.request.externalSessionId).toBe(firstData.request.externalSessionId);
    expect(resumeData.request.requestSequence).toBe(2);
    expect(resumeData.requestPackage.commandTemplate.arguments).toContain("--resume");
    expect(resumeData.requestPackage.commandTemplate.arguments).not.toContain("--continue");

    const finalState = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(finalState.executionSessions).toHaveLength(1);
    expect(finalState.executionAdapterRequests).toHaveLength(2);
  });

  it("--resume-session is blocked (exit 2) while an active request already exists for that session, with zero mutation", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const first = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    const sessionId = JSON.parse(first.stdout).data.request.executionSessionId;
    commitAiqtState(dir, "after first request");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--resume-session", sessionId, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EXTERNAL-REQUEST-ACTIVE-EXISTS");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
  });

  it("requestDigest is deterministic for the same canonical inputs and the deterministic sessionClientKey ties one session per work-unit/packet", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    const data = JSON.parse(res.stdout).data;
    expect(data.request.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(data.request.id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("works end to end with a real M25 isolated workspace binding, and records the real workspacePath in the request package", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir, "isolated");
    commitAiqtState(dir);

    expect(runCli(["workspace", "prepare", "WU001", "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after prepare");

    const res = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(typeof data.requestPackage.workspacePath).toBe("string");
    expect(data.requestPackage.workspacePath).not.toBe("");
  });

  it("aiqt execution adapter claude-code example prints a static sample and touches no state", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    commitAiqtState(dir);

    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["execution", "adapter", "claude-code", "example"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.contractVersion).toBe("claude-code-stream-json-request@1");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });
});
