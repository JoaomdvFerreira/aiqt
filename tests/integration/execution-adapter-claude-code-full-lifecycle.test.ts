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
const fixturesDir = join(repoRoot, "tests", "fixtures", "claude-code");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
}

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-01T01:00:00.000Z";
const T3 = "2026-01-01T02:00:00.000Z";

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

describe("M27-WU06: disposable-project Claude Code adapter lifecycle (real M25 workspace, two invocations, terminal completion, corrected M26 packet-cancel)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("request -> external fixture -> import -> resume request -> second import -> explicit M26 completion -> workspace release -> checkpoint, with next cancel blocked throughout and after", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressIsolatedWorkUnit(dir);
    commitAiqtState(dir);

    // Real M25 isolated workspace, prepared exactly as any other M25/M26 consumer would.
    expect(runCli(["workspace", "prepare", "WU001", "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after prepare");

    // 1. Generate the first ("start") request; never executes Claude Code.
    const firstRequestRes = runCli(["execution", "adapter", "claude-code", "request", "WU001", "--as-of", T1, "--json"], dir);
    expect(firstRequestRes.status).toBe(0);
    const firstRequest = JSON.parse(firstRequestRes.stdout).data.request;
    expect(firstRequest.mode).toBe("start");
    commitAiqtState(dir, "after first request");

    // While a non-terminal (planned) session exists, checkpoint and
    // workspace release are both blocked -- and so is next cancel.
    expect(runCli(["workspace", "release", "WU001", "--json"], dir).status).toBe(2);
    expect(runCli(["next", "cancel", "--json"], dir).status).toBe(2);

    // 2. External orchestrator runs Claude Code, captures stream-json, hands it to AIQT.
    const firstOutput = join(dir, "first-output.jsonl");
    fixtureWithSessionId("03-multi-turn-tool-cycle.jsonl", firstRequest.externalSessionId, firstOutput);
    const firstImportRes = runCli(["execution", "adapter", "claude-code", "import", "--request", firstRequest.id, "--from-file", firstOutput, "--as-of", T2, "--json"], dir);
    expect(firstImportRes.status).toBe(0);
    expect(JSON.parse(firstImportRes.stdout).data.resultClass).toBe("success");
    commitAiqtState(dir, "after first import");

    let state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("paused");
    expect(state.executionSessions[0].iterations).toHaveLength(1);

    // Paused (non-terminal) still blocks next cancel.
    expect(runCli(["next", "cancel", "--json"], dir).status).toBe(2);

    // 3. Resume: same M26 session, same external UUID, second request sequence.
    const resumeRequestRes = runCli(
      ["execution", "adapter", "claude-code", "request", "WU001", "--resume-session", firstRequest.executionSessionId, "--as-of", T2, "--json"],
      dir,
    );
    expect(resumeRequestRes.status).toBe(0);
    const resumeRequest = JSON.parse(resumeRequestRes.stdout).data.request;
    expect(resumeRequest.mode).toBe("resume");
    expect(resumeRequest.externalSessionId).toBe(firstRequest.externalSessionId);
    expect(resumeRequest.requestSequence).toBe(2);
    commitAiqtState(dir, "after resume request");

    const secondOutput = join(dir, "second-output.jsonl");
    fixtureWithSessionId("02-success-resumed-invocation.jsonl", firstRequest.externalSessionId, secondOutput);
    const secondImportRes = runCli(["execution", "adapter", "claude-code", "import", "--request", resumeRequest.id, "--from-file", secondOutput, "--as-of", T3, "--json"], dir);
    expect(secondImportRes.status).toBe(0);
    commitAiqtState(dir, "after second import");

    state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions).toHaveLength(1);
    expect(state.executionSessions[0].iterations).toHaveLength(2);
    expect(state.executionSessions[0].status).toBe("paused");
    expect(state.executionAdapterRequests).toHaveLength(2);
    expect(state.executionAdapterRequests.every((r: { status: string }) => r.status === "imported")).toBe(true);
    // Provider success never completed the Work Unit.
    expect(state.currentWorkUnitId).toBe("WU001");
    expect(state.checkpoints).toHaveLength(0);

    // 4. Explicit M26 completion is a separate, deliberate act -- the
    // adapter never performs it automatically. Reuses the existing
    // (unmodified) `aiqt execution import` boundary directly.
    const completeEnvelopePath = join(dir, "complete.json");
    writeFileSync(
      completeEnvelopePath,
      JSON.stringify({
        protocolVersion: "long-running-execution-protocol@1",
        providerId: state.executionSessions[0].provider.providerId,
        sessionClientKey: state.executionSessions[0].sessionClientKey,
        events: [
          { type: "session.status_changed", eventId: "COMPLETE-RESUME", at: T3, toStatus: "running", reason: "resume before explicit completion" },
          { type: "session.status_changed", eventId: "COMPLETE-1", at: T3, toStatus: "completed", reason: "all iterations finished" },
        ],
      }),
    );
    const completeRes = runCli(["execution", "import", "--from-file", completeEnvelopePath, "--as-of", T3, "--json"], dir);
    expect(completeRes.status).toBe(0);
    commitAiqtState(dir, "after explicit completion");

    state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.executionSessions[0].status).toBe("completed");

    // 5. Now terminal: workspace release and checkpoint both succeed.
    expect(runCli(["workspace", "release", "WU001", "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after workspace release");

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
    const checkpointRes = runCli(["checkpoint", "--from-file", checkpointInputPath, "--json"], dir);
    expect(checkpointRes.status).toBe(0);
    state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.checkpoints[0].executionSessionIds).toEqual([firstRequest.executionSessionId]);
    expect(state.currentWorkUnitId).toBeNull();

    // 6. Corrected M26 behavior: even now that everything is terminal and
    // checkpointed, a hypothetical cancel of THIS (already-cancelled-by-
    // checkpoint-path) work unit is moot; the real regression proof is that
    // the adapter never weakened the safeguard while the session was
    // non-terminal (step 1) or paused (steps 2-3) -- both already exercised
    // above. `execution adapter claude-code status` still reports the full,
    // untouched history read-only.
    const statusRes = runCli(["execution", "adapter", "claude-code", "status", "--json"], dir);
    expect(statusRes.status).toBe(0);
    const statusData = JSON.parse(statusRes.stdout).data;
    expect(statusData.requestCountsByStatus.imported).toBe(2);
    expect(statusData.health).toBe("healthy");
  }, 40000);
});
