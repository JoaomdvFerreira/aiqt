import { describe, it, expect, afterEach, vi } from "vitest";
import { HEAVY_SPAWNING_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
// M34-WU02: promoted to the HEAVY tier -- this file's heaviest test measured
// 11.6-13.2s isolated, only ~1.1-1.3x headroom over the 15000ms class
// default (docs/engineering/m34-validation-workload-policy.md Sec 3/6.1),
// and was observed to still occasionally exceed it under real full-suite load.
vi.setConfig({ testTimeout: HEAVY_SPAWNING_TEST_TIMEOUT_MS });

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

function samplePolicy(): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "release-gate",
    version: 1,
    name: "Release Gate",
    targetScopes: ["checkpoint"],
    rules: [
      {
        ruleId: "test-results-present",
        title: "Test results present",
        appliesTo: ["checkpoint"],
        evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" },
        requirement: { minimumCount: 1 },
        missingDisposition: "fail",
      },
    ],
  };
}

function makeInProgressProjectViaCli(dir: string): void {
  initGitRepo(dir);
  expect(runCli(["init", "--json"], dir).status).toBe(0);
  expect(
    runCli(["update", "--objective", "Ship it", "--target-user", "devs", "--json"], dir).status,
  ).toBe(0);
  const patchPath = join(dir, "patch.json");
  writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
  expect(runCli(["update", "--from-file", patchPath, "--json"], dir).status).toBe(0);
  const planPath = join(dir, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      milestones: [{ clientKey: "m1", title: "M1", objective: "O" }],
      workUnits: [
        {
          clientKey: "wu1",
          milestoneClientKey: "m1",
          title: "WU1",
          objective: "O",
          scope: ["s"],
          outOfScope: ["o"],
          acceptanceCriteria: ["a"],
          agentContextRefs: [],
          suggestedFiles: [],
          validationCommands: ["true"],
        },
      ],
      dependencies: [],
    }),
  );
  expect(runCli(["plan", "--from-file", planPath, "--json"], dir).status).toBe(0);
  expect(runCli(["next", "--json"], dir).status).toBe(0);
}

function checkpointDonePath(dir: string): string {
  const path = join(dir, "checkpoint.json");
  writeFileSync(
    path,
    JSON.stringify({
      summary: "done",
      completed: ["a"],
      notCompleted: [],
      filesChanged: [],
      issues: [],
      validationResult: "passed",
      acceptanceCriteriaResult: "passed",
      validationCommands: [],
      acceptanceCriteria: [],
      targetStatus: "done",
    }),
  );
  return path;
}

describe("M29-WU03: hardening -- runlog-gap repair, historical compatibility, privacy, boundaries", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a runlog-append failure during an explicit advisory refresh leaves state authoritative (exit 3); a retry with the same --as-of backfills the missing event without duplicating state", () => {
    dir = makeTempDir();
    makeInProgressProjectViaCli(dir);
    expect(runCli(["checkpoint", "--from-file", checkpointDonePath(dir), "--json"], dir).status).toBe(0);
    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir).status).toBe(0);

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const checkpointId = state.checkpoints[0].id;
    const asOf = "2026-02-01T00:00:00.000Z";

    chmodSync(runlogPath, 0o444);
    let observationId: string;
    try {
      const failed = runCli(["evidence", "gate", "advisory", "refresh", "--checkpoint", checkpointId, "--as-of", asOf, "--json"], dir);
      // Unlike the automatic checkpoint trigger, refresh's ENTIRE purpose is
      // the advisory operation, so a runlog gap here IS surfaced as a
      // command failure (M29 §7.2).
      expect(failed.status).toBe(3);
      expect(JSON.parse(failed.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-ADVISORY-REFRESH-RUNLOG-APPEND-FAILED");

      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.checkpointEvidenceAdvisories).toHaveLength(1);
      observationId = stateAfterFailure.checkpointEvidenceAdvisories[0].current.observationId;
      expect(readFileSync(runlogPath, "utf8")).not.toContain(observationId);
    } finally {
      chmodSync(runlogPath, 0o644);
    }

    // Retry with the SAME --as-of reproduces the identical observationId ->
    // no_op at the state layer, but must still detect and backfill the
    // missing runlog event rather than silently doing nothing.
    const repairResult = runCli(["evidence", "gate", "advisory", "refresh", "--checkpoint", checkpointId, "--as-of", asOf, "--json"], dir);
    expect(repairResult.status).toBe(0);
    expect(JSON.parse(repairResult.stdout).data.outcome).toBe("repaired");

    const finalRunlog = readFileSync(runlogPath, "utf8");
    expect(finalRunlog).toContain(observationId!);
    const matchingEvents = finalRunlog
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === "evidence_gate.advisory_observation_recorded" && e.data.observationId === observationId);
    expect(matchingEvents).toHaveLength(1); // this exact observation is never duplicated in the runlog
    const finalState = JSON.parse(readFileSync(statePath, "utf8"));
    expect(finalState.checkpointEvidenceAdvisories).toHaveLength(1); // still one advisory record for this checkpoint (current mirror), never duplicated

    // A further identical retry is now a genuine no-op (nothing to repair).
    const thirdResult = runCli(["evidence", "gate", "advisory", "refresh", "--checkpoint", checkpointId, "--as-of", asOf, "--json"], dir);
    expect(thirdResult.status).toBe(0);
    expect(JSON.parse(thirdResult.stdout).data.outcome).toBe("no_op");
  }, 30000);

  it("a legacy pre-M29 state.json (no checkpointEvidenceAdvisories/evidenceAdvisoryFeedback fields) remains valid for status/review/manage/export, and checkpoint completion introduces the fields additively", () => {
    dir = makeTempDir();
    makeInProgressProjectViaCli(dir);

    const statePath = join(dir, ".aiqt", "state.json");
    const stateBeforeCheckpoint = JSON.parse(readFileSync(statePath, "utf8"));
    expect("checkpointEvidenceAdvisories" in stateBeforeCheckpoint).toBe(false);
    expect("evidenceAdvisoryFeedback" in stateBeforeCheckpoint).toBe(false);
    expect(runCli(["status", "--json"], dir).status).toBe(0);
    expect(runCli(["manage", "--json"], dir).status).toBe(0);

    expect(runCli(["checkpoint", "--from-file", checkpointDonePath(dir), "--json"], dir).status).toBe(0);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    // Additive: checkpointEvidenceAdvisories now exists (every automatic
    // evaluation -- even not_configured -- records an observation);
    // evidenceAdvisoryFeedback remains absent until feedback is given.
    expect(state.checkpointEvidenceAdvisories).toHaveLength(1);
    expect("evidenceAdvisoryFeedback" in state).toBe(false);

    expect(runCli(["status", "--json"], dir).status).toBe(0);
    expect(runCli(["review", "--json"], dir).status === 0 || runCli(["review", "--json"], dir).status === 1).toBe(true);
    expect(runCli(["manage", "--json"], dir).status).toBe(0);
    expect(runCli(["export", "status-report", "--json"], dir).status).toBe(0);

    const amend = runCli(["checkpoint", "amend", "--checkpoint", state.checkpoints[0].id, "--acceptance", "passed", "--reason", "no-op amendment check", "--json"], dir);
    expect(amend.status).toBe(0);
  }, 30000);

  it("the advisory observation runlog event contains only the approved bounded fields -- no raw evidence, artifact content, or human rationale", () => {
    dir = makeTempDir();
    makeInProgressProjectViaCli(dir);
    expect(runCli(["checkpoint", "--from-file", checkpointDonePath(dir), "--json"], dir).status).toBe(0);

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const events = readFileSync(runlogPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === "evidence_gate.advisory_observation_recorded");
    expect(events).toHaveLength(1);
    const allowedKeys = new Set([
      "observationId",
      "checkpointId",
      "workUnitId",
      "trigger",
      "evaluationStatus",
      "overallResult",
      "policyRef",
      "asOf",
      "simulationDigest",
      "issueKeys",
      "recordedAt",
    ]);
    for (const key of Object.keys(events[0].data)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  }, 20000);

  it("the checkpoint-advisory workflow modules add no process, network, or dynamic-loading surface", () => {
    const modules = [
      "checkpoint-advisory-evaluation.ts",
      "checkpoint-advisory-integration.ts",
      "checkpoint-advisory-identity.ts",
      "checkpoint-advisory-state.ts",
      "checkpoint-advisory-persistence.ts",
      "checkpoint-advisory-issues.ts",
      "checkpoint-advisory-visibility.ts",
      "evidence-advisory-telemetry.ts",
    ];
    for (const mod of modules) {
      const src = readFileSync(join(repoRoot, "src", "workflow", mod), "utf8");
      expect(src).not.toMatch(/child_process|node-fetch|require\(|import\(|new Function\(/);
    }
  });
});
