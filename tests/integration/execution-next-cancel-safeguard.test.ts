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
const T1_PLUS_2H_1S = "2026-01-01T02:00:01.000Z";

/**
 * M26 §5.3 post-closure correction: `aiqt next cancel` must remain
 * blocked (exit 2) whenever ANY execution session exists for the
 * current packet -- terminal or not. Unlike checkpoint and workspace
 * release, a terminal session does NOT unblock cancellation, because
 * cancelling the packet would invalidate durable execution history that
 * already happened. This file exists specifically to prove that,
 * independent of the "no current work unit" and "checkpoint already
 * exists" blockers, which fire for unrelated reasons and must not be
 * confused with the execution-session safeguard under test here.
 */
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
    executionMetadata: {
      workspaceAssignment: { mode: "none", access: "read_only" },
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
  return { protocolVersion: "long-running-execution-protocol@1", providerId: "example.provider", sessionClientKey: "client-1", events };
}

function importAt(dir: string, name: string, events: unknown[], asOf: string) {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(envelope(events)));
  return runCli(["execution", "import", "--from-file", path, "--as-of", asOf, "--json"], dir);
}

/** Confirms the block is specifically the execution-session safeguard (not the unrelated "no current work unit" or "checkpoint exists" blockers), exit 2, and zero state/runlog mutation. */
function expectExecutionSessionBlocked(dir: string, res: ReturnType<typeof runCli>, stateBefore: string, runlogBefore: string) {
  expect(res.status).toBe(2);
  const parsed = JSON.parse(res.stdout);
  expect(parsed.status).toBe("blocked");
  expect(parsed.blockingIssues[0].id).toBe("NEXT-CANCEL-EXECUTION-SESSION-EXISTS");
  const statePath = join(dir, ".aiqt", "state.json");
  const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
  expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
}

describe("M26 post-closure correction: aiqt next cancel blocks on ANY execution session (terminal or not)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a running (non-terminal) execution session blocks packet cancellation", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    expect(importAt(dir, "open", [{ type: "session.opened", eventId: "E1", at: T1 }], T1).status).toBe(0);
    expect(
      importAt(dir, "run", [{ type: "session.status_changed", eventId: "E2", at: T1, toStatus: "running", reason: "start" }], T1).status,
    ).toBe(0);

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    const res = runCli(["next", "cancel", "--json"], dir);
    expectExecutionSessionBlocked(dir, res, stateBefore, runlogBefore);
  });

  it("a completed (terminal) execution session still blocks packet cancellation", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    expect(importAt(dir, "open", [{ type: "session.opened", eventId: "E1", at: T1 }], T1).status).toBe(0);
    expect(
      importAt(
        dir,
        "complete",
        [
          { type: "session.status_changed", eventId: "E2", at: T1, toStatus: "running", reason: "start" },
          { type: "session.status_changed", eventId: "E3", at: T1, toStatus: "completed", reason: "done" },
        ],
        T1,
      ).status,
    ).toBe(0);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("completed");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    const res = runCli(["next", "cancel", "--json"], dir);
    expectExecutionSessionBlocked(dir, res, stateBefore, runlogBefore);
  });

  it("a failed (terminal) execution session still blocks packet cancellation", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    expect(importAt(dir, "open", [{ type: "session.opened", eventId: "E1", at: T1 }], T1).status).toBe(0);
    expect(
      importAt(dir, "fail", [{ type: "session.status_changed", eventId: "E2", at: T1, toStatus: "failed", reason: "provider startup failure" }], T1)
        .status,
    ).toBe(0);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("failed");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    const res = runCli(["next", "cancel", "--json"], dir);
    expectExecutionSessionBlocked(dir, res, stateBefore, runlogBefore);
  });

  it("a cancelled execution session still blocks packet cancellation", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    expect(importAt(dir, "open", [{ type: "session.opened", eventId: "E1", at: T1 }], T1).status).toBe(0);
    expect(
      importAt(dir, "cancel-session", [{ type: "session.status_changed", eventId: "E2", at: T1, toStatus: "cancelled", reason: "provider aborted" }], T1)
        .status,
    ).toBe(0);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("cancelled");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    const res = runCli(["next", "cancel", "--json"], dir);
    expectExecutionSessionBlocked(dir, res, stateBefore, runlogBefore);
  });

  it("a stale execution session blocks packet cancellation", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    expect(
      importAt(dir, "open", [{ type: "session.opened", eventId: "E1", at: T1, budgets: { staleAfterSeconds: 3600 } }], T1).status,
    ).toBe(0);
    const staleRes = runCli(["execution", "stale", "--apply", "--as-of", T1_PLUS_2H_1S, "--json"], dir);
    expect(staleRes.status).toBe(0);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("stale");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    const res = runCli(["next", "cancel", "--json"], dir);
    expectExecutionSessionBlocked(dir, res, stateBefore, runlogBefore);
  });

  it("no execution session preserves the existing (pre-M26) cancellation path, even with the executionSessions field present but empty", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionSessions = [];
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const res = runCli(["next", "cancel", "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout);
    expect(data.data.workUnitId).toBe("WU001");
    const finalState = JSON.parse(readFileSync(statePath, "utf8"));
    expect(finalState.currentWorkUnitId).toBeNull();
  });

  it("checkpoint and workspace release still correctly unblock once a session is terminal (contrast case, proving next cancel's stricter rule is deliberate, not a shared bug)", () => {
    dir = makeTempDir();
    execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
    writeFileSync(join(dir, "README.md"), "hello\n");
    execFileSync("git", ["add", "README.md"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: dir });

    expect(runCli(["init", "--json"], dir).status).toBe(0);
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
      executionMetadata: { workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" }, parallelPolicy: { mode: "serialized", resourceClaims: [] } },
    });
    state.workGraph.milestones.push({ id: "M001", title: "M", objective: "O", status: "in_progress", workUnitIds: ["WU001"] });
    state.currentWorkUnitId = "WU001";
    state.currentMilestoneId = "M001";
    state.lastAgentPacket = { id: "PKT-001", workUnitId: "WU001", milestoneId: "M001", createdAt: T1, format: "markdown", contentHash: "sha256:" + "a".repeat(64), sourceCommand: "aiqt next" };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    execFileSync("git", ["add", ".aiqt"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "aiqt state"], { cwd: dir });

    expect(runCli(["workspace", "prepare", "WU001", "--json"], dir).status).toBe(0);
    execFileSync("git", ["add", ".aiqt"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "after prepare"], { cwd: dir });

    expect(importAt(dir, "open", [{ type: "session.opened", eventId: "E1", at: T1 }], T1).status).toBe(0);
    expect(
      importAt(dir, "cancel-session", [{ type: "session.status_changed", eventId: "E2", at: T1, toStatus: "cancelled", reason: "done" }], T1).status,
    ).toBe(0);
    execFileSync("git", ["add", ".aiqt"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "session terminal"], { cwd: dir });

    // Workspace release: terminal session does not block.
    expect(runCli(["workspace", "release", "WU001", "--json"], dir).status).toBe(0);
    execFileSync("git", ["add", ".aiqt"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "after release"], { cwd: dir });

    // Checkpoint: terminal session (no open decision, no running iteration) does not block.
    const checkpointInputPath = join(dir, "checkpoint.json");
    writeFileSync(
      checkpointInputPath,
      JSON.stringify({
        summary: "done",
        completed: ["a"],
        notCompleted: [],
        filesChanged: [],
        issues: [],
        validationResult: "passed",
        acceptanceCriteriaResult: "passed",
        validationCommands: [{ command: "true", result: "passed" }],
        acceptanceCriteria: [{ criterion: "a", result: "passed" }],
        targetStatus: "done",
      }),
    );
    expect(runCli(["checkpoint", "--from-file", checkpointInputPath, "--json"], dir).status).toBe(0);
  }, 40000);
});
