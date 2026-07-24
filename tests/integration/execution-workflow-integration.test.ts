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

function seedInProgressIsolatedWorkUnit(dir: string): void {
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
    executionMetadata: {
      workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
      parallelPolicy: { mode: "serialized", resourceClaims: [] },
    },
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

function envelope(events: unknown[]) {
  return {
    protocolVersion: "long-running-execution-protocol@1",
    providerId: "example.provider",
    sessionClientKey: "client-1",
    events,
  };
}

function checkpointInput() {
  return {
    summary: "Implemented the feature.",
    completed: ["a"],
    notCompleted: [],
    filesChanged: ["src/foo.ts"],
    issues: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [{ command: "true", result: "passed" }],
    acceptanceCriteria: [{ criterion: "a", result: "passed" }],
    targetStatus: "done",
  };
}

describe("M26-WU04: checkpoint/workspace-release/packet-cancel safeguards, execution status, review/manage integration", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a non-terminal execution session blocks checkpoint, next cancel, and workspace release; checkpoint and workspace release unblock once terminal, but next cancel remains blocked by any session history", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressIsolatedWorkUnit(dir);
    commitAiqtState(dir);

    // Real M25 isolated workspace prepare.
    const prepareRes = runCli(["workspace", "prepare", "WU001", "--json"], dir);
    expect(prepareRes.status).toBe(0);
    commitAiqtState(dir, "state after workspace prepare");

    // Real M26 session open -- workspaceRef resolves to the active M25 binding automatically.
    const openPath = join(dir, "open.json");
    writeFileSync(openPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    const openRes = runCli(["execution", "import", "--from-file", openPath, "--json"], dir);
    expect(openRes.status).toBe(0);
    const sessionId = JSON.parse(openRes.stdout).data.targetSessionId as string;

    // execution status reports the non-terminal session.
    const statusRes = runCli(["execution", "status", "--session", sessionId, "--json"], dir);
    expect(statusRes.status).toBe(0);
    expect(JSON.parse(statusRes.stdout).data.session.status).toBe("planned");

    // review flags nothing blocking yet (session isn't terminal, so no
    // terminal-awaiting-checkpoint finding); manage reports 1 active session.
    const manageBeforeRes = runCli(["manage", "--json"], dir);
    expect(manageBeforeRes.status).toBe(0);
    expect(JSON.parse(manageBeforeRes.stdout).data.execution.activeSessions).toBe(1);

    // checkpoint is blocked (exit 2) while the session is non-terminal.
    const checkpointInputPath = join(dir, "checkpoint.json");
    writeFileSync(checkpointInputPath, JSON.stringify(checkpointInput()));
    const blockedCheckpoint = runCli(["checkpoint", "--from-file", checkpointInputPath, "--json"], dir);
    expect(blockedCheckpoint.status).toBe(2);

    // next cancel is blocked (exit 2) because any execution session exists for the packet.
    const blockedCancel = runCli(["next", "cancel", "--json"], dir);
    expect(blockedCancel.status).toBe(2);

    // workspace release is blocked (exit 2) because a non-terminal session references the workspace.
    const blockedRelease = runCli(["workspace", "release", "WU001", "--json"], dir);
    expect(blockedRelease.status).toBe(2);

    // Transition the session to a terminal status. planned -> completed is
    // not a direct allowed transition (only planned -> running/failed/
    // cancelled/stale); cancelled is the simplest terminal status reachable
    // directly from planned.
    const closePath = join(dir, "close.json");
    writeFileSync(
      closePath,
      JSON.stringify(envelope([{ type: "session.status_changed", eventId: "E2", at: T1, toStatus: "cancelled", reason: "work finished" }])),
    );
    const closeRes = runCli(["execution", "import", "--from-file", closePath, "--json"], dir);
    expect(closeRes.status).toBe(0);
    commitAiqtState(dir, "state after session closed");

    // review now flags terminal-awaiting-checkpoint (non-blocking).
    const reviewRes = runCli(["review", "--json"], dir);
    expect(reviewRes.status === 0 || reviewRes.status === 1).toBe(true);
    const reviewData = JSON.parse(reviewRes.status === 0 ? reviewRes.stdout : reviewRes.stderr);
    expect(reviewData.data.findings.some((f: { findingKey: string }) => f.findingKey.includes("terminal-awaiting-checkpoint"))).toBe(true);

    // manage now reports terminalAwaitingCheckpoint and a recommended action mentioning checkpoint.
    const manageAfterRes = runCli(["manage", "--json"], dir);
    expect(manageAfterRes.status).toBe(0);
    const manageAfterData = JSON.parse(manageAfterRes.stdout).data;
    expect(manageAfterData.execution.terminalAwaitingCheckpoint).toBe(1);
    expect(manageAfterData.execution.recommendedAction).toContain("checkpoint");

    // workspace release now succeeds (terminal sessions do not block release).
    const releaseRes = runCli(["workspace", "release", "WU001", "--json"], dir);
    expect(releaseRes.status).toBe(0);
    commitAiqtState(dir, "state after workspace release");

    // checkpoint now proceeds (no non-terminal session, no open decision).
    const checkpointRes = runCli(["checkpoint", "--from-file", checkpointInputPath, "--json"], dir);
    expect(checkpointRes.status).toBe(0);
    const checkpointState = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(checkpointState.checkpoints[0].executionSessionIds).toEqual([sessionId]);
  }, 40000);

  it("execution status (unfiltered) and --work-unit report bounded summaries", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    // A "none"-mode work unit avoids needing a real M25 workspace for this read-only check.
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.workGraph.workUnits.push({
      id: "WU001",
      milestoneId: "M001",
      title: "T",
      objective: "O",
      scope: [],
      outOfScope: [],
      acceptanceCriteria: [],
      agentContextRefs: [],
      suggestedFiles: [],
      validationCommands: [],
      status: "in_progress",
      dependencies: [],
      createdAt: T1,
      updatedAt: T1,
      executionMetadata: { workspaceAssignment: { mode: "none", access: "read_only" }, parallelPolicy: { mode: "serialized", resourceClaims: [] } },
    });
    state.workGraph.milestones.push({ id: "M001", title: "M", objective: "O", status: "in_progress", workUnitIds: ["WU001"] });
    state.currentWorkUnitId = "WU001";
    state.lastAgentPacket = { id: "PKT-001", workUnitId: "WU001", milestoneId: "M001", createdAt: T1, format: "markdown", contentHash: "sha256:" + "a".repeat(64), sourceCommand: "aiqt next" };
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const openPath = join(dir, "open.json");
    writeFileSync(openPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    expect(runCli(["execution", "import", "--from-file", openPath, "--json"], dir).status).toBe(0);

    const allRes = runCli(["execution", "status", "--json"], dir);
    expect(allRes.status).toBe(0);
    expect(JSON.parse(allRes.stdout).data.totalSessions).toBe(1);

    const wuRes = runCli(["execution", "status", "--work-unit", "WU001", "--json"], dir);
    expect(wuRes.status).toBe(0);
    expect(JSON.parse(wuRes.stdout).data.totalSessions).toBe(1);

    const otherRes = runCli(["execution", "status", "--work-unit", "WU999", "--json"], dir);
    expect(otherRes.status).toBe(0);
    expect(JSON.parse(otherRes.stdout).data.totalSessions).toBe(0);
  });

  it("does not add a session field or execution summary change for a legacy project with no sessions", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const manageRes = runCli(["manage", "--json"], dir);
    expect(manageRes.status).toBe(0);
    expect(JSON.parse(manageRes.stdout).data.execution.totalSessions).toBe(0);

    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.executionSessions).toBeUndefined();
  });
});
