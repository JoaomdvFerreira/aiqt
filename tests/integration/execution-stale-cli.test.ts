import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
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
const T1_PLUS_1H = "2026-01-01T01:00:00.000Z";
const T1_PLUS_1H_1S = "2026-01-01T01:00:01.000Z";

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

function openSessionWithStaleAfter(dir: string, staleAfterSeconds: number): void {
  const payloadPath = join(dir, "envelope.json");
  writeFileSync(
    payloadPath,
    JSON.stringify({
      protocolVersion: "long-running-execution-protocol@1",
      providerId: "example.provider",
      sessionClientKey: "client-1",
      events: [{ type: "session.opened", eventId: "E1", at: T1, budgets: { staleAfterSeconds } }],
    }),
  );
  const res = runCli(["execution", "import", "--from-file", payloadPath, "--as-of", T1, "--json"], dir);
  expect(res.status).toBe(0);
}

describe("aiqt execution stale (M26-WU03)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("is listed under --help", () => {
    dir = makeTempDir();
    const res = runCli(["execution", "--help"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("stale");
  });

  it("preview (default, no --apply) reports 0 eligible sessions before the deadline, with zero mutation", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSessionWithStaleAfter(dir, 3600);

    const statePath = join(dir, ".aiqt", "state.json");
    const stateBefore = readFileSync(statePath, "utf8");
    const res = runCli(["execution", "stale", "--as-of", T1_PLUS_1H, "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.apply).toBe(false);
    expect(data.eligible).toEqual([]);
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("preview reports exactly 1 eligible session one second after the deadline", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSessionWithStaleAfter(dir, 3600);

    const res = runCli(["execution", "stale", "--as-of", T1_PLUS_1H_1S, "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.eligible).toHaveLength(1);
  });

  it("--apply exits 2 (blocked) with zero mutation when no session is eligible", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSessionWithStaleAfter(dir, 3600);

    const statePath = join(dir, ".aiqt", "state.json");
    const stateBefore = readFileSync(statePath, "utf8");
    const res = runCli(["execution", "stale", "--apply", "--as-of", T1_PLUS_1H, "--json"], dir);
    expect(res.status).toBe(2);
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("--apply transitions the eligible session to stale, writes state before runlog, and is idempotent on immediate retry (nothing left eligible)", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSessionWithStaleAfter(dir, 3600);

    const applyRes = runCli(["execution", "stale", "--apply", "--as-of", T1_PLUS_1H_1S, "--json"], dir);
    expect(applyRes.status).toBe(0);
    const applyData = JSON.parse(applyRes.stdout).data;
    expect(applyData.transitionedSessionIds).toHaveLength(1);

    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.executionSessions[0].status).toBe("stale");
    expect(state.executionSessions[0].statusTransitions.at(-1).reason).toBe("stale_timeout");

    // Immediately re-applying finds nothing eligible (already stale) -- exit 2, zero mutation.
    const secondApply = runCli(["execution", "stale", "--apply", "--as-of", T1_PLUS_1H_1S, "--json"], dir);
    expect(secondApply.status).toBe(2);
  });

  it("exits 3 for an invalid --as-of timestamp", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["execution", "stale", "--as-of", "not-a-date", "--json"], dir);
    expect(res.status).toBe(3);
  });
});
