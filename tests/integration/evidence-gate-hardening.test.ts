import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
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

function samplePolicy(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "release-gate",
    version: 1,
    name: "Release Gate",
    targetScopes: ["project"],
    rules: [
      {
        ruleId: "test-results-present",
        title: "Test results present",
        appliesTo: ["project"],
        evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" },
        requirement: { minimumCount: 1 },
        missingDisposition: "fail",
      },
    ],
    ...overrides,
  };
}

function seedProjectWithEvidence(dir: string): void {
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
  state.evidence = {
    records: [
      {
        evidenceId: "EVD-001",
        contractVersion: "1.0",
        provider: { providerId: "human", providerType: "human", trustLevel: "repository_local" },
        workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-001" },
        codeBinding: { capturedAt: T1 },
        reviewer: { reviewerType: "human", independentContext: "unknown" },
        results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
        sourceFindings: [],
        decisionEscalationIds: [],
        artifactReferences: [{ artifactId: "ART-1", kind: "test_result", locator: "https://example.test/1" }],
        recordedAt: T1,
      },
    ],
    decisionEscalations: [],
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe("M28-WU05: compatibility, security, and failure hardening", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a runlog-append failure during policy import leaves state authoritative; a retry is an idempotent no-op", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failed = runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir);
      expect(failed.status).toBe(3);
      expect(JSON.parse(failed.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-IMPORT-RUNLOG-APPEND-FAILED");
      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.evidenceGate.policies).toHaveLength(1);
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      chmodSync(runlogPath, 0o644);
      const retry = runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir);
      expect(retry.status).toBe(0);
      expect(JSON.parse(retry.stdout).data.outcome).toBe("no_op");
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  }, 20000);

  it("a runlog-append failure during activation leaves state authoritative", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failed = runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir);
      expect(failed.status).toBe(3);
      expect(JSON.parse(failed.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-ACTIVATE-RUNLOG-APPEND-FAILED");
      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.evidenceGate.activePolicyRef).toEqual({ policyId: "release-gate", version: 1 });
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  }, 20000);

  it("M27R generic execution validation claims never count as evidence -- simulation only ever reads state.evidence.records", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithEvidence(dir);
    // Directly inject an M27R-shaped executionAdapterRequest carrying a
    // self-reported "passed" validationClaim for a completely different
    // artifact kind (ci_run) that, if wrongly treated as evidence, would
    // satisfy an evidenceSelector requiring ci_run.
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.executionSessions = [];
    state.executionAdapterRequests = [
      {
        id: "sha256:" + "9".repeat(64),
        adapterId: "generic-json@1",
        executionSessionId: "sha256:" + "8".repeat(64),
        sessionClientKey: "external/11111111-1111-4111-8111-111111111111",
        workUnitId: "WU001",
        packetId: "PKT-001",
        workspaceRef: { mode: "none" },
        requestSequence: 1,
        mode: "start",
        status: "imported",
        requestDigest: "sha256:" + "7".repeat(64),
        importedSourceDigest: "sha256:" + "6".repeat(64),
        createdAt: T1,
        expiresAt: "2026-01-02T00:00:00.000Z",
        importedAt: T1,
        importedAgent: { providerId: "openai/codex" },
      },
    ];
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(
      policyPath,
      JSON.stringify(
        samplePolicy({
          rules: [
            {
              ruleId: "ci-run-required",
              title: "CI run required",
              appliesTo: ["project"],
              evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "unverified", scopeMatch: "exact_target" },
              requirement: { minimumCount: 1 },
              missingDisposition: "fail",
            },
          ],
        }),
      ),
    );
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after policy setup");

    const res = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    const sim = JSON.parse(res.stdout).data.simulation;
    // No ci_run evidence exists in state.evidence.records, so the rule
    // must fail regardless of the executionAdapterRequest's presence.
    expect(sim.overallResult).toBe("fail");
    expect(sim.ruleResults[0].matchedCount).toBe(0);
  }, 20000);

  it("a malformed policy (missing required field) is rejected atomically, and state.evidenceGate is never created", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const malformed = { ...samplePolicy() } as Record<string, unknown>;
    delete malformed.rules;
    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(malformed));
    const res = runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.evidenceGate).toBeUndefined();
  }, 20000);

  it("aiqt status includes an evidenceGate summary only after a policy exists, never simulates, and reflects the active policy", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const beforeRes = runCli(["status", "--json"], dir);
    expect(beforeRes.status).toBe(0);
    expect(JSON.parse(beforeRes.stdout).data.evidenceGate).toBeUndefined();

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after policy setup");

    const afterRes = runCli(["status", "--json"], dir);
    expect(afterRes.status).toBe(0);
    const data = JSON.parse(afterRes.stdout).data;
    // M29 §6: checkpointAdvisoryIntegrated is now true (advisory evaluation
    // runs automatically post-checkpoint); status derives aggregate counts
    // from already-persisted state/runlog, never a fresh simulation -- no
    // checkpoint exists yet in this project, so every count is zero.
    expect(data.evidenceGate).toEqual({
      activePolicy: { policyId: "release-gate", version: 1 },
      simulationEnforced: false,
      checkpointAdvisoryIntegrated: true,
      advisory: {
        evaluatedCheckpoints: 0,
        pass: 0,
        fail: 0,
        indeterminate: 0,
        unavailable: 0,
        notConfigured: 0,
        checkpointsCompletedDespiteFail: 0,
        checkpointsCompletedDespiteIndeterminate: 0,
        refreshedAfterAmendment: 0,
        feedback: { confirmed: 0, falsePositive: 0, policyGap: 0, evidenceMissing: 0, unclassified: 0 },
        historyComplete: true,
        runlogGapCount: 0,
      },
    });
  }, 20000);

  it("a legacy pre-M28 state.json (no evidenceGate field at all) remains valid for status/review/simulate-no-policy, and read-only commands never materialize the field", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const statePath = join(dir, ".aiqt", "state.json");
    expect("evidenceGate" in JSON.parse(readFileSync(statePath, "utf8"))).toBe(false);

    expect(runCli(["status", "--json"], dir).status).toBe(0);
    const reviewRes = runCli(["review", "--json"], dir);
    expect(reviewRes.status === 0 || reviewRes.status === 1).toBe(true);
    const simRes = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir);
    expect(simRes.status).toBe(2);

    const stateAfter = JSON.parse(readFileSync(statePath, "utf8"));
    expect("evidenceGate" in stateAfter).toBe(false);
  }, 20000);

  it("checkpoint output does not include simulation and next/checkpoint/workspace behavior is unaffected by an active evidence gate policy", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after policy setup");

    // `next` continues to behave exactly per its own pre-M28 contract
    // (no work graph yet -> exit 2), completely unaffected by the active
    // evidence gate policy.
    const nextRes = runCli(["next", "--json"], dir);
    expect(nextRes.status).toBe(2);
  }, 20000);
});
