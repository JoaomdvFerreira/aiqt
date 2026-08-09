import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir } from "../helpers.js";
import { BUILT_CLI_ENTRY } from "../cli-runner.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });


function runCli(args: string[], cwd: string, input?: string) {
  return spawnSync(process.execPath, [BUILT_CLI_ENTRY, ...args], { cwd, encoding: "utf8", input });
}

const T1 = "2026-01-01T00:00:00.000Z";

/** Seeds an in_progress work unit with a current packet and no checkpoint, matching session-open preconditions. */
function seedInProgressWorkUnitWithPacket(dir: string, options: { workspaceMode?: "none" } = {}): void {
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
      workspaceAssignment: { mode: options.workspaceMode ?? "none", access: "read_only" },
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

function envelope(events: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "long-running-execution-protocol@1",
    providerId: "example.provider",
    sessionClientKey: "client-1",
    events,
    ...overrides,
  };
}

describe("aiqt execution import (M26-WU02)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("is listed under --help", () => {
    dir = makeTempDir();
    const res = runCli(["--help"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("execution");
  });

  it("--example prints a sample envelope and exits 0 without requiring an .aiqt/ project", () => {
    dir = makeTempDir();
    const res = runCli(["execution", "import", "--example"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.protocolVersion).toBe("long-running-execution-protocol@1");
  });

  it("exits 10 when neither --from-file nor --stdin is given", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["execution", "import", "--json"], dir);
    expect(res.status).toBe(10);
  });

  it("exits 3 when both --from-file and --stdin are given", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    const res = runCli(["execution", "import", "--from-file", payloadPath, "--stdin", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 with no .aiqt/ project", () => {
    dir = makeTempDir();
    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    const res = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 for malformed JSON", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, "{ not json");
    const res = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 for an unknown event type", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.teleported", eventId: "E1", at: T1 }])));
    const res = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 for an invalid --as-of timestamp", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    const res = runCli(["execution", "import", "--from-file", payloadPath, "--as-of", "not-a-date", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 when opening a session for a work unit that is not in_progress", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    const res = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("--preview performs zero mutation and reports the plan with exit 0", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const stateBefore = readFileSync(statePath, "utf8");

    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    const res = runCli(["execution", "import", "--from-file", payloadPath, "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.outcome).toBe("created");
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("applies (writes state + runlog), exits 0, and a full replay is an idempotent no-op", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);

    const payloadPath = join(dir, "envelope.json");
    writeFileSync(
      payloadPath,
      JSON.stringify(
        envelope([
          { type: "session.opened", eventId: "E1", at: T1 },
          { type: "iteration.started", eventId: "E2", at: T1, providerIterationKey: "iter-1" },
        ]),
      ),
    );
    const applyRes = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
    expect(applyRes.status).toBe(0);
    const applyData = JSON.parse(applyRes.stdout).data;
    expect(applyData.outcome).toBe("created");
    expect(applyData.appliedEventCount).toBe(2);

    const statePath = join(dir, ".aiqt", "state.json");
    const stateAfterFirst = readFileSync(statePath, "utf8");

    const replayRes = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
    expect(replayRes.status).toBe(0);
    const replayData = JSON.parse(replayRes.stdout).data;
    expect(replayData.outcome).toBe("no_op");
    expect(replayData.noOpEventCount).toBe(2);
    expect(readFileSync(statePath, "utf8")).toBe(stateAfterFirst);
  });

  it("rejects a conflicting replay (same eventId, different content) with exit 3 and zero mutation", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);

    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    expect(runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir).status).toBe(0);

    const statePath = join(dir, ".aiqt", "state.json");
    const stateBefore = readFileSync(statePath, "utf8");

    const conflictPath = join(dir, "conflict.json");
    writeFileSync(conflictPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1, externalSessionId: "different" }])));
    const res = runCli(["execution", "import", "--from-file", conflictPath, "--json"], dir);
    expect(res.status).toBe(3);
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("reads the payload from --stdin", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const payload = JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }]));
    const res = runCli(["execution", "import", "--stdin", "--json"], dir, payload);
    expect(res.status).toBe(0);
  });

  it("a runlog-append failure after a successful state write leaves state.json correct, and a retry is a safe idempotent no-op with no duplication", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);

    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));

    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failedRun = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
      expect(failedRun.status).toBe(3);

      const stateAfterFailure = readFileSync(statePath, "utf8");
      expect(stateAfterFailure).not.toBe(stateBefore);
      const parsedState = JSON.parse(stateAfterFailure);
      expect(parsedState.executionSessions).toHaveLength(1);
      const sessionId = parsedState.executionSessions[0].id;

      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      chmodSync(runlogPath, 0o644);
      const retryRun = runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir);
      expect(retryRun.status).toBe(0);
      const retryData = JSON.parse(retryRun.stdout).data;
      expect(retryData.outcome).toBe("no_op");
      expect(retryData.targetSessionId).toBe(sessionId);

      const finalState = JSON.parse(readFileSync(statePath, "utf8"));
      expect(finalState.executionSessions).toHaveLength(1);
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  });

  it("does not add a new runlog event type on a no-op replay (no runlog event for a full no-op)", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const payloadPath = join(dir, "envelope.json");
    writeFileSync(payloadPath, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1 }])));
    expect(runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir).status).toBe(0);

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const runlogAfterFirst = readFileSync(runlogPath, "utf8");
    expect(runCli(["execution", "import", "--from-file", payloadPath, "--json"], dir).status).toBe(0);
    expect(readFileSync(runlogPath, "utf8")).toBe(runlogAfterFirst);
  });
});
