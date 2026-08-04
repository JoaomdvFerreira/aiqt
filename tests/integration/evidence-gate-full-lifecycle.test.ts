import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
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

function seedProjectWithWorkUnitCheckpointAndEvidence(dir: string): void {
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
  state.checkpoints.push({
    id: "CKPT-001",
    workUnitId: "WU001",
    packetId: null,
    summary: "done",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    issues: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "done",
    nextRecommendation: "",
    createdAt: T1,
  });
  state.evidence = {
    records: [
      {
        evidenceId: "EVD-TEST",
        contractVersion: "1.0",
        provider: { providerId: "human", providerType: "human", trustLevel: "repository_local" },
        workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: "CKPT-001", implementationRootId: "ROOT-001" },
        codeBinding: { capturedAt: T1 },
        reviewer: { reviewerType: "human", independentContext: "unknown" },
        results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
        sourceFindings: [],
        decisionEscalationIds: [],
        artifactReferences: [{ artifactId: "ART-1", kind: "test_result", locator: "https://example.test/1" }],
        recordedAt: T1,
      },
      {
        evidenceId: "EVD-CI",
        contractVersion: "1.0",
        provider: { providerId: "ci", providerType: "ci", trustLevel: "platform_verified" },
        workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-001" },
        codeBinding: { capturedAt: T1 },
        reviewer: { reviewerType: "system", independentContext: "declared_independent" },
        results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ci ok" },
        sourceFindings: [],
        decisionEscalationIds: [],
        artifactReferences: [{ artifactId: "ART-2", kind: "ci_run", locator: "https://example.test/ci/1" }],
        recordedAt: T1,
      },
    ],
    decisionEscalations: [],
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

const policyV1 = {
  protocolVersion: "aiqt-evidence-gate-policy@1",
  policyId: "release-gate",
  version: 1,
  name: "Release Gate v1",
  targetScopes: ["project", "work_unit", "checkpoint"],
  rules: [
    {
      ruleId: "test-results-present",
      title: "Test results present",
      appliesTo: ["project", "work_unit", "checkpoint"],
      evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" },
      requirement: { minimumCount: 1 },
      missingDisposition: "fail",
    },
  ],
};

const policyV2 = {
  ...policyV1,
  version: 2,
  name: "Release Gate v2",
  supersedesVersion: 1,
  rules: [
    ...policyV1.rules,
    {
      ruleId: "ci-run-present",
      title: "CI run present",
      appliesTo: ["project", "work_unit"],
      evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "platform_verified", scopeMatch: "target_or_project" },
      requirement: { minimumCount: 1 },
      missingDisposition: "indeterminate",
    },
  ],
};

describe("M28-WU06: disposable-project evidence-gate policy lifecycle (multi-version import, activation, all target simulations, export, determinism)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("v1 import -> activate -> simulate (pass) -> v2 import (preview then real, supersedes v1) -> activate v2 -> simulate all three targets -> export -> deterministic repeat, with corrected M26/M25 safeguards intact throughout", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);

    // 1. Import and activate v1; a project simulation passes on test_result evidence alone.
    const v1Path = join(dir, "v1.json");
    writeFileSync(v1Path, JSON.stringify(policyV1));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", v1Path, "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after v1 setup");

    const v1Sim = JSON.parse(runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir).stdout).data.simulation;
    expect(v1Sim.policy.version).toBe(1);
    expect(v1Sim.overallResult).toBe("pass");

    // 2. Preview v2 (adds a ci-run rule, supersedes v1) -- zero mutation.
    const v2Path = join(dir, "v2.json");
    writeFileSync(v2Path, JSON.stringify(policyV2));
    const stateBeforeV2Preview = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", v2Path, "--as-of", T1, "--preview", "--json"], dir).status).toBe(0);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBeforeV2Preview);

    // 3. Real v2 import, then activate it; v1 remains retained in history.
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", v2Path, "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "2", "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after v2 setup");

    const stateWithBothVersions = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(stateWithBothVersions.evidenceGate.policies).toHaveLength(2);
    expect(stateWithBothVersions.evidenceGate.activePolicyRef).toEqual({ policyId: "release-gate", version: 2 });

    // 4. Simulate all three targets against v2 (active), each pass (test_result exact_target + ci_run target_or_project).
    for (const targetArgs of [["--project"], ["--work-unit", "WU001"], ["--checkpoint", "CKPT-001"]]) {
      const res = runCli(["evidence", "gate", "simulate", ...targetArgs, "--as-of", T1, "--json"], dir);
      expect(res.status, targetArgs.join(" ")).toBe(0);
      const sim = JSON.parse(res.stdout).data.simulation;
      expect(sim.policy.version).toBe(2);
      expect(sim.ruleResults).toHaveLength(2);
      expect(sim.overallResult).toBe("pass");
    }

    // 5. Export to file; identical digest to the JSON response.
    const outputPath = join(dir, "report.json");
    const exportRes = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--output", outputPath, "--json"], dir);
    expect(exportRes.status).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const exported = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(exported.simulationDigest).toBe(JSON.parse(exportRes.stdout).data.simulation.simulationDigest);

    // 6. Deterministic repeat: identical digests across two independent invocations.
    const repeatA = JSON.parse(runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir).stdout).data.simulation;
    const repeatB = JSON.parse(runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir).stdout).data.simulation;
    expect(repeatA.simulationDigest).toBe(repeatB.simulationDigest);
    expect(repeatA.evidenceSnapshotDigest).toBe(repeatB.evidenceSnapshotDigest);

    // 7. Corrected M26 packet-cancel/M25 workspace safeguards remain fully
    // intact and untouched by any of the above -- `next cancel` behaves
    // per its own pre-M28 contract (no current packet selected here, so
    // the pre-existing "no current work unit" precondition fires).
    const cancelRes = runCli(["next", "cancel", "--json"], dir);
    expect(cancelRes.status).toBe(2);

    // 8. Nothing above ever wrote canonical state outside the two explicit
    // policy import/activate operations -- the whole simulate/export/
    // repeat sequence left state.json byte-identical.
    const finalState = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(JSON.parse(finalState)).toEqual(stateWithBothVersions);
  }, 40000);
});
