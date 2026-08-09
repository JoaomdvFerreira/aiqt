import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
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
const T2 = "2026-01-01T00:10:00.000Z";
const T3 = "2026-01-01T00:20:00.000Z";
const T4 = "2026-01-01T00:30:00.000Z";
const T5 = "2026-01-01T00:40:00.000Z";
const T5_PLUS_2H_1S = "2026-01-01T02:40:01.000Z";

function initGitRepo(dir: string): void {
  initGitFixtureRepo(dir);
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
  return { protocolVersion: "long-running-execution-protocol@1", providerId: "acme.coding-agent/v1", sessionClientKey: "client-full-lifecycle", events };
}

function importAt(dir: string, name: string, events: unknown[], asOf: string) {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(envelope(events)));
  return runCli(["execution", "import", "--from-file", path, "--as-of", asOf, "--json"], dir);
}

describe("M26-WU06: complete multi-iteration disposable-project execution-session lifecycle", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("open -> two iterations -> decision requested/resolved -> budget update -> rollback reported -> references/summary -> resume -> complete -> stale-preview no-op -> checkpoint, with a real M25 isolated workspace end to end", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressIsolatedWorkUnit(dir);
    commitAiqtState(dir);

    expect(runCli(["workspace", "prepare", "WU001", "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after prepare");

    // 1. Open with a budget configured.
    const open = importAt(
      dir,
      "1-open",
      [{ type: "session.opened", eventId: "E1", at: T1, budgets: { maxIterations: 5, staleAfterSeconds: 7200 } }],
      T1,
    );
    expect(open.status).toBe(0);
    const sessionId = JSON.parse(open.stdout).data.targetSessionId as string;

    // 2. Move to running, then iteration 1 (finished cleanly).
    const iter1 = importAt(
      dir,
      "2-iter1",
      [
        { type: "session.status_changed", eventId: "E2", at: T1, toStatus: "running", reason: "agent started" },
        { type: "iteration.started", eventId: "E3", at: T1, providerIterationKey: "iter-1", objectiveSummary: "Scaffold the feature" },
        {
          type: "iteration.finished",
          eventId: "E4",
          at: T2,
          providerIterationKey: "iter-1",
          status: "completed",
          resultSummary: "Scaffolding complete.",
          reportedTokens: 4000,
          reportedDurationSeconds: 300,
          commitRefs: [{ sha: "abc1234", message: "Scaffold feature" }],
        },
      ],
      T2,
    );
    expect(iter1.status).toBe(0);

    // 3. Iteration 2 requests a decision mid-flight; requesting the
    // decision auto-blocks the session (running -> blocked).
    const iter2Start = importAt(
      dir,
      "3-iter2-start",
      [
        { type: "iteration.started", eventId: "E5", at: T2, providerIterationKey: "iter-2" },
        { type: "decision.requested", eventId: "E6", at: T3, providerDecisionKey: "dec-1", title: "Pick a library", question: "axios or fetch?", options: ["axios", "fetch"] },
      ],
      T3,
    );
    expect(iter2Start.status).toBe(0);

    // While blocked, a new iteration.started is rejected (exit 2) --
    // but iter-2 is already running, so this specifically proves the
    // "at most one running iteration" gate rather than the decision gate.
    const blockedSecondStart = importAt(dir, "3b-blocked", [{ type: "iteration.started", eventId: "E6b", at: T3, providerIterationKey: "iter-3" }], T3);
    expect(blockedSecondStart.status).toBe(2);

    // Checkpoint is blocked while the session is non-terminal.
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
    expect(runCli(["checkpoint", "--from-file", checkpointInputPath, "--json"], dir).status).toBe(2);

    // 4. Resolve the decision (does not auto-resume), finish iteration 2,
    // report a budget update, an unverified rollback, and add references.
    const resolveAndFinish = importAt(
      dir,
      "4-resolve-finish",
      [
        { type: "decision.resolved", eventId: "E7", at: T3, providerDecisionKey: "dec-1", selectedOption: "axios", resolutionSummary: "axios chosen for interceptor support" },
        { type: "iteration.finished", eventId: "E8", at: T4, providerIterationKey: "iter-2", status: "completed", resultSummary: "Wired up axios client.", reportedTokens: 6000, reportedDurationSeconds: 600 },
        { type: "session.budget_updated", eventId: "E9", at: T4, budgets: { maxIterations: 5, staleAfterSeconds: 7200 } },
        { type: "rollback.reported", eventId: "E10", at: T4, providerRollbackKey: "rb-1", targetRef: "abc1234", reasonSummary: "Reverted an experimental branch the agent tried and abandoned.", scope: "iteration" },
        { type: "session.references_added", eventId: "E11", at: T4, commitRefs: [{ sha: "def5678", message: "Wire up axios" }] },
        { type: "session.summary_updated", eventId: "E12", at: T4, learningSummary: "axios's interceptor API made auth token refresh straightforward." },
      ],
      T4,
    );
    expect(resolveAndFinish.status).toBe(0);

    // Session is still "blocked" (decision.resolved never auto-resumes) --
    // an explicit resume is required before completion.
    const midStatus = runCli(["execution", "status", "--session", sessionId, "--json"], dir);
    expect(JSON.parse(midStatus.stdout).data.session.status).toBe("blocked");
    expect(JSON.parse(midStatus.stdout).data.session.openDecisionCount).toBe(0);

    // 5. Explicit resume, then complete (no running iteration, no open decision).
    const complete = importAt(
      dir,
      "5-complete",
      [
        { type: "session.status_changed", eventId: "E13", at: T5, toStatus: "running", reason: "resume after decision" },
        { type: "session.status_changed", eventId: "E14", at: T5, toStatus: "completed", reason: "all iterations finished" },
      ],
      T5,
    );
    expect(complete.status).toBe(0);

    // 6. Stale preview two hours+1s after the last activity finds nothing
    // eligible -- the session is already terminal, not merely idle.
    const stalePreview = runCli(["execution", "stale", "--as-of", T5_PLUS_2H_1S, "--json"], dir);
    expect(stalePreview.status).toBe(0);
    expect(JSON.parse(stalePreview.stdout).data.eligible).toEqual([]);

    // 7. Full session detail via execution status.
    const finalStatus = runCli(["execution", "status", "--session", sessionId, "--json"], dir);
    expect(finalStatus.status).toBe(0);
    const finalData = JSON.parse(finalStatus.stdout).data;
    expect(finalData.session.status).toBe("completed");
    expect(finalData.iterations).toHaveLength(2);
    expect(finalData.iterations.every((i: { status: string }) => i.status === "completed")).toBe(true);
    expect(finalData.decisions).toHaveLength(1);
    expect(finalData.decisions[0].status).toBe("resolved");
    expect(finalData.rollbackRecords).toHaveLength(1);
    expect(finalData.commitRefs).toHaveLength(1);
    expect(finalData.learningSummary).toContain("interceptor");

    // 8. Release the (now historically-referenced-only) workspace and checkpoint.
    commitAiqtState(dir, "after full session lifecycle");
    expect(runCli(["workspace", "release", "WU001", "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after workspace release");
    const checkpointRes = runCli(["checkpoint", "--from-file", checkpointInputPath, "--json"], dir);
    expect(checkpointRes.status).toBe(0);
    const finalState = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(finalState.checkpoints[0].executionSessionIds).toEqual([sessionId]);
    expect(finalState.currentWorkUnitId).toBeNull();
  }, 60000);
});
