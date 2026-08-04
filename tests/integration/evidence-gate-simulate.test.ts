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

function samplePolicy(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "release-gate",
    version: 1,
    name: "Release Gate",
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
    ...overrides,
  };
}

function seedProjectWithWorkUnitCheckpointAndEvidence(dir: string): { projectId: string } {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const projectPath = join(dir, ".aiqt", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));

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
        evidenceId: "EVD-001",
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
    ],
    decisionEscalations: [],
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return { projectId: project.project.id };
}

function importAndActivate(dir: string, policy: Record<string, unknown>) {
  const policyPath = join(dir, "policy.json");
  writeFileSync(policyPath, JSON.stringify(policy));
  expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
  expect(runCli(["evidence", "gate", "policy", "activate", policy.policyId as string, "--version", String(policy.version ?? 1), "--as-of", T1, "--json"], dir).status).toBe(0);
}

describe("M28-WU04: aiqt evidence gate simulate", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("simulates against the active policy for --project, --work-unit, and --checkpoint targets, each producing pass with matched evidence", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy());
    commitAiqtState(dir, "after policy setup");

    for (const targetArgs of [["--project"], ["--work-unit", "WU001"], ["--checkpoint", "CKPT-001"]]) {
      const res = runCli(["evidence", "gate", "simulate", ...targetArgs, "--as-of", T1, "--json"], dir);
      expect(res.status, targetArgs.join(" ")).toBe(0);
      const sim = JSON.parse(res.stdout).data.simulation;
      expect(sim.overallResult).toBe("pass");
      expect(sim.ruleResults[0].matchedEvidenceRefs).toEqual(["EVD-001"]);
      expect(sim.policy.policyId).toBe("release-gate");
    }
  }, 20000);

  it("never mutates canonical state or runlog for any simulation outcome", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy());
    commitAiqtState(dir, "after policy setup");

    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    expect(runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  }, 20000);

  it("fail and indeterminate outcomes both return exit 0 (outcome is data, not a CLI failure)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);

    importAndActivate(dir, samplePolicy({ policyId: "fail-policy", rules: [{ ruleId: "r1", title: "R1", appliesTo: ["project"], evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "unverified", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "fail" }] }));
    commitAiqtState(dir, "after fail-policy setup");
    const failRes = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir);
    expect(failRes.status).toBe(0);
    expect(JSON.parse(failRes.stdout).data.simulation.overallResult).toBe("fail");

    importAndActivate(dir, samplePolicy({ policyId: "indeterminate-policy", rules: [{ ruleId: "r1", title: "R1", appliesTo: ["project"], evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "unverified", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "indeterminate" }] }));
    commitAiqtState(dir, "after indeterminate-policy setup");
    const indRes = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir);
    expect(indRes.status).toBe(0);
    expect(JSON.parse(indRes.stdout).data.simulation.overallResult).toBe("indeterminate");
  }, 20000);

  it("zero applicable rules produces indeterminate, exit 0", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy({ rules: [{ ruleId: "r1", title: "R1", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "unverified", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "fail" }] }));
    commitAiqtState(dir, "after policy setup");

    const res = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).data.simulation.overallResult).toBe("indeterminate");
    expect(JSON.parse(res.stdout).data.simulation.ruleResults[0].result).toBe("not_applicable");
  }, 20000);

  it("no active or explicit policy returns exit 2", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);

    const res = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(2);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-SIMULATE-NO-POLICY");
  }, 20000);

  it("an explicit but nonexistent policy/version is rejected (exit 3)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);

    const res = runCli(["evidence", "gate", "simulate", "--project", "--policy", "no-such-policy", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-SIMULATE-UNKNOWN-POLICY");
  }, 20000);

  it("an unknown work-unit or checkpoint target is rejected (exit 3)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy());
    commitAiqtState(dir, "after policy setup");

    expect(runCli(["evidence", "gate", "simulate", "--work-unit", "WU-DOES-NOT-EXIST", "--as-of", T1, "--json"], dir).status).toBe(3);
    expect(runCli(["evidence", "gate", "simulate", "--checkpoint", "CKPT-DOES-NOT-EXIST", "--as-of", T1, "--json"], dir).status).toBe(3);
  }, 20000);

  it("more than one target flag is rejected (exit 3); no target flag is exit 10", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy());
    commitAiqtState(dir, "after policy setup");

    expect(runCli(["evidence", "gate", "simulate", "--project", "--work-unit", "WU001", "--as-of", T1, "--json"], dir).status).toBe(3);
    expect(runCli(["evidence", "gate", "simulate", "--as-of", T1, "--json"], dir).status).toBe(10);
  }, 20000);

  it("an invalid --as-of is rejected (exit 3)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy());
    commitAiqtState(dir, "after policy setup");

    const res = runCli(["evidence", "gate", "simulate", "--project", "--as-of", "not-a-timestamp", "--json"], dir);
    expect(res.status).toBe(3);
  }, 20000);

  it("--output writes the full report to a file, matching the JSON data payload", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy());
    commitAiqtState(dir, "after policy setup");

    const outputPath = join(dir, "report.json");
    const res = runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--output", outputPath, "--json"], dir);
    expect(res.status).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(written.simulationDigest).toBe(JSON.parse(res.stdout).data.simulation.simulationDigest);
  }, 20000);

  it("repeating the exact same simulation produces the identical simulationDigest and evidenceSnapshotDigest", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedProjectWithWorkUnitCheckpointAndEvidence(dir);
    commitAiqtState(dir);
    importAndActivate(dir, samplePolicy());
    commitAiqtState(dir, "after policy setup");

    const first = JSON.parse(runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir).stdout).data.simulation;
    const second = JSON.parse(runCli(["evidence", "gate", "simulate", "--project", "--as-of", T1, "--json"], dir).stdout).data.simulation;
    expect(first.simulationDigest).toBe(second.simulationDigest);
    expect(first.evidenceSnapshotDigest).toBe(second.evidenceSnapshotDigest);
    expect(first.generatedAt).not.toBe(second.generatedAt);
  }, 20000);
});
