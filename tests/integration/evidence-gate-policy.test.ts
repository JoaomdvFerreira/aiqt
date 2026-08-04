import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";

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
  initGitFixtureRepo(dir);
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
        appliesTo: ["work_unit", "checkpoint"],
        evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" },
        requirement: { minimumCount: 1 },
        missingDisposition: "fail",
      },
    ],
    ...overrides,
  };
}

describe("M28-WU02: aiqt evidence gate policy import/list/show/activate", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("imports a new policy version and persists it in state.evidenceGate", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    const res = runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.policy.policyId).toBe("release-gate");
    expect(data.policy.version).toBe(1);
    expect(data.policy.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.evidenceGate.policies).toHaveLength(1);
    expect(state.evidenceGate.activePolicyRef).toBeUndefined();
  });

  it("--preview writes nothing", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("re-importing the exact same content is an idempotent no-op", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).data.outcome).toBe("no_op");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("the same (policyId, version) with different content is a digest conflict (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const changedPath = join(dir, "policy2.json");
    writeFileSync(changedPath, JSON.stringify(samplePolicy({ name: "Release Gate (renamed)" })));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["evidence", "gate", "policy", "import", "--from-file", changedPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-IMPORT-DIGEST-CONFLICT");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("a non-monotonic version is rejected (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy({ version: 2 })));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after v2 import");

    const olderPath = join(dir, "policy-v1.json");
    writeFileSync(olderPath, JSON.stringify(samplePolicy({ version: 1, name: "Different" })));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const res = runCli(["evidence", "gate", "policy", "import", "--from-file", olderPath, "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-IMPORT-VERSION-NOT-MONOTONIC");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("an unknown artifact kind or trust value is rejected atomically (no invented taxonomy)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const badKindPath = join(dir, "bad-kind.json");
    writeFileSync(
      badKindPath,
      JSON.stringify(
        samplePolicy({
          rules: [
            {
              ruleId: "r1",
              title: "Bad",
              appliesTo: ["project"],
              evidenceSelector: { artifactKinds: ["screenshot_of_a_screenshot"], minimumTrust: "repository_local", scopeMatch: "exact_target" },
              requirement: { minimumCount: 1 },
              missingDisposition: "fail",
            },
          ],
        }),
      ),
    );
    const res1 = runCli(["evidence", "gate", "policy", "import", "--from-file", badKindPath, "--as-of", T1, "--json"], dir);
    expect(res1.status).toBe(3);
    expect(JSON.parse(res1.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-IMPORT-SCHEMA-INVALID");

    const badTrustPath = join(dir, "bad-trust.json");
    writeFileSync(
      badTrustPath,
      JSON.stringify(
        samplePolicy({
          rules: [
            {
              ruleId: "r1",
              title: "Bad",
              appliesTo: ["project"],
              evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "verified_by_the_universe", scopeMatch: "exact_target" },
              requirement: { minimumCount: 1 },
              missingDisposition: "fail",
            },
          ],
        }),
      ),
    );
    const res2 = runCli(["evidence", "gate", "policy", "import", "--from-file", badTrustPath, "--as-of", T1, "--json"], dir);
    expect(res2.status).toBe(3);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.evidenceGate).toBeUndefined();
  });

  it("list and show report imported policies read-only", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);

    const listRes = runCli(["evidence", "gate", "policy", "list", "--json"], dir);
    expect(listRes.status).toBe(0);
    const listData = JSON.parse(listRes.stdout).data;
    expect(listData.policies).toHaveLength(1);
    expect(listData.policies[0].policyId).toBe("release-gate");
    expect(listData.activePolicyRef).toBeNull();

    const showRes = runCli(["evidence", "gate", "policy", "show", "release-gate", "--json"], dir);
    expect(showRes.status).toBe(0);
    expect(JSON.parse(showRes.stdout).data.policy.rules).toHaveLength(1);
  });

  it("activate changes only the active reference (preview writes nothing, real activation appends exactly one runlog event, re-activating is a no-op)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    expect(runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir).status).toBe(0);
    commitAiqtState(dir, "after import");

    const beforePreview = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--preview", "--as-of", T1, "--json"], dir).status).toBe(0);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforePreview);

    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim().split("\n").length;
    const activateRes = runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir);
    expect(activateRes.status).toBe(0);
    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.evidenceGate.activePolicyRef).toEqual({ policyId: "release-gate", version: 1 });
    // Activation never touches the persisted policy array itself.
    expect(state.evidenceGate.policies).toHaveLength(1);
    const runlogAfter = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim().split("\n").length;
    expect(runlogAfter).toBe(runlogBefore + 1);
    commitAiqtState(dir, "after activate");

    const beforeReactivate = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const reactivateRes = runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir);
    expect(reactivateRes.status).toBe(0);
    expect(JSON.parse(reactivateRes.stdout).data.outcome).toBe("no_op");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforeReactivate);
  });

  it("activating a nonexistent policy version fails atomically", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    commitAiqtState(dir);

    const res = runCli(["evidence", "gate", "policy", "activate", "no-such-policy", "--version", "1", "--as-of", T1, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stdout).blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-ACTIVATE-NOT-FOUND");
  });
});
