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


function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BUILT_CLI_ENTRY, ...args], { cwd, encoding: "utf8" });
}

const planPayload = {
  milestones: [{ clientKey: "m1", title: "M1", objective: "Objective" }],
  workUnits: [
    {
      clientKey: "wu1",
      milestoneClientKey: "m1",
      title: "WU1",
      objective: "Objective",
      scope: ["scope"],
      outOfScope: ["out"],
      acceptanceCriteria: ["criterion"],
      agentContextRefs: [],
      suggestedFiles: [],
      validationCommands: ["pnpm test"],
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
        parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
      },
    },
  ],
  dependencies: [],
};

/**
 * M24-WU08 §14.3: proves the inherited
 * authoritative_state_with_advisory_runlog_gap recovery model (documented
 * for M23 in GOVERNANCE.md) also holds for M24's own metadata mutation
 * path (`aiqt plan --from-file` carrying executionMetadata), not just for
 * evidence import. Same write-then-append sequence, same technique
 * (a read-only runlog.jsonl so loadProject's pre-flight health check
 * still passes, but appendRunlogEvent's appendFileSync fails).
 */
describe("M24 execution-metadata mutation: runlog-append failure recovery (WU24-08)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a runlog-append failure after a successful plan-with-metadata state write leaves state.json correct, and a retry is a safe no-op with no duplicate graph records", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    expect(runCli(["update", "--objective", "Ship it", "--target-user", "devs"], dir).status).toBe(0);
    const contextPatchPath = join(dir, "context-patch.json");
    writeFileSync(contextPatchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
    expect(runCli(["update", "--from-file", contextPatchPath], dir).status).toBe(0);

    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, JSON.stringify(planPayload));

    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failedRun = runCli(["plan", "--from-file", planPath, "--json"], dir);
      expect(failedRun.status).toBe(3);

      // Property 1: the state write landed even though the command
      // reported failure.
      const stateAfterFailure = readFileSync(statePath, "utf8");
      expect(stateAfterFailure).not.toBe(stateBefore);
      const parsedState = JSON.parse(stateAfterFailure);
      expect(parsedState.workGraph.workUnits).toHaveLength(1);
      expect(parsedState.workGraph.workUnits[0].executionMetadata.workspaceAssignment.assignmentKey).toBe("wu-1");

      chmodSync(runlogPath, 0o644);

      // Retrying the identical `aiqt plan --from-file` after a plan has
      // already been generated is rejected by the pre-existing
      // "graph not empty" guard (unrelated to M24) -- which itself proves
      // no duplicate graph mutation occurs on retry: the second attempt
      // makes no further change to state.json at all.
      const stateBeforeRetry = readFileSync(statePath, "utf8");
      const retryRun = runCli(["plan", "--from-file", planPath, "--json"], dir);
      expect(retryRun.status).not.toBe(0);
      expect(readFileSync(statePath, "utf8")).toBe(stateBeforeRetry);

      const finalState = JSON.parse(readFileSync(statePath, "utf8"));
      expect(finalState.workGraph.workUnits).toHaveLength(1);
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  }, 20000);
});
