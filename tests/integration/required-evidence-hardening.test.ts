import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { BUILT_CLI_ENTRY } from "../cli-runner.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BUILT_CLI_ENTRY, ...args], { cwd, encoding: "utf8" });
}

const T1 = "2026-01-01T00:00:00.000Z";

function initGitRepo(dir: string): void {
  initGitFixtureRepo(dir);
}

function samplePolicy(): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "release-gate",
    version: 1,
    name: "Release Gate",
    targetScopes: ["checkpoint"],
    rules: [
      { ruleId: "test-results-present", title: "T", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "fail" },
    ],
  };
}

function sampleProfile(policyDigest: string): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-evidence-enforcement-profile@1",
    profileId: "release-required",
    version: 1,
    name: "Release Required",
    gates: {
      checkpoint: {
        policyRef: { policyId: "release-gate", version: 1, digest: policyDigest },
        bindingRequirements: { workUnit: "required" },
        onFail: "needs_review",
        onIndeterminate: "needs_review",
        onUnavailable: "needs_review",
        exceptionEligibleRuleIds: ["test-results-present"],
      },
    },
    activationRequirements: {
      minimumAdvisoryObservations: 3,
      minimumClassifiedFindings: 0,
      maximumAcceptedFalsePositiveRate: 0.5,
      requireCompleteAdvisoryHistory: true,
      requireEveryRuleObserved: true,
      requireEveryRuleRecoveryProof: true,
      requireNoUnavailableObservation: true,
      requireNoOpenDeadlockFinding: true,
    },
  };
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}
function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}

describe("M30-WU07: hardening -- runlog-gap repair, boundary scans, historical compatibility", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a fully read-only runlog during a required-decision checkpoint still leaves the required-evidence downgrade captured in state (state remains authoritative)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    expect(runCli(["update", "--objective", "Ship it", "--target-user", "devs", "--json"], dir).status).toBe(0);
    const patchPath = join(dir, "patch.json");
    writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
    expect(runCli(["update", "--from-file", patchPath, "--json"], dir).status).toBe(0);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "M1", objective: "O" }],
        workUnits: [{ clientKey: "wu1", milestoneClientKey: "m1", title: "WU1", objective: "O", scope: ["s"], outOfScope: ["o"], acceptanceCriteria: ["a"], agentContextRefs: [], suggestedFiles: [], validationCommands: ["true"] }],
        dependencies: [],
      }),
    );
    expect(runCli(["plan", "--from-file", planPath, "--json"], dir).status).toBe(0);
    expect(runCli(["next", "--json"], dir).status).toBe(0);

    const policyPath = join(dir, "policy.json");
    writeFileSync(policyPath, JSON.stringify(samplePolicy()));
    const importResult = runCli(["evidence", "gate", "policy", "import", "--from-file", policyPath, "--as-of", T1, "--json"], dir);
    expect(importResult.status).toBe(0);
    const policyDigest = JSON.parse(importResult.stdout).data.policy.policyDigest;
    expect(runCli(["evidence", "gate", "policy", "activate", "release-gate", "--version", "1", "--as-of", T1, "--json"], dir).status).toBe(0);

    const profilePath = join(dir, "profile.json");
    writeFileSync(profilePath, JSON.stringify(sampleProfile(policyDigest)));
    expect(runCli(["evidence", "gate", "enforcement", "profile", "import", "--from-file", profilePath, "--json"], dir).status).toBe(0);

    // Seed an active activation directly (activation lifecycle itself is covered elsewhere).
    const state = readState(dir);
    state.requiredModeActivations = [
      {
        protocolVersion: "aiqt-required-mode-activation@1",
        activationId: "ACT-001",
        planId: "RMAP-001",
        profileRef: { profileId: "release-required", version: 1 },
        activationSnapshotDigest: "sha256:8888888888888888888888888888888888888888888888888888888888888888".slice(0, 71),
        activatedAt: T1,
        activatedBy: "alice",
        reason: "fixture",
        grandfatheredWorkUnitIds: [],
        status: "active",
      },
    ];
    // Evidence present but below minimum trust -> deficiency "insufficient_trust",
    // governed by onFail=needs_review (unlike "missing", which always
    // blocks with zero mutation regardless of onFail).
    state.evidence = {
      records: [
        {
          evidenceId: "EVD-1",
          contractVersion: "1.0",
          provider: { providerId: "human", providerType: "human", trustLevel: "unverified" },
          workflowBinding: { workUnitId: "WU001", packetId: state.lastAgentPacket.id, checkpointId: "C001", implementationRootId: "ROOT-001" },
          codeBinding: { capturedAt: state.lastUpdatedAt },
          reviewer: { reviewerType: "human", independentContext: "unknown" },
          results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
          sourceFindings: [],
          decisionEscalationIds: [],
          artifactReferences: [{ artifactId: "ART-1", kind: "test_result", locator: "https://example.test/1" }],
          recordedAt: state.lastUpdatedAt,
        },
      ],
      decisionEscalations: [],
    };
    writeState(dir, state);

    const checkpointPath = join(dir, "checkpoint.json");
    writeFileSync(checkpointPath, JSON.stringify({ summary: "done", completed: ["a"], notCompleted: [], filesChanged: [], issues: [], validationResult: "passed", acceptanceCriteriaResult: "passed", validationCommands: [{ command: "true", result: "passed" }], acceptanceCriteria: [{ criterion: "a", result: "passed" }], targetStatus: "done" }));

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    chmodSync(runlogPath, 0o444);
    try {
      const checkpointResult = runCli(["checkpoint", "--from-file", checkpointPath, "--json"], dir);
      // A fully read-only runlog fails the checkpoint's own pre-existing
      // mandatory events too (not just the M30 required-decision event) --
      // this is pre-existing M5/M26 behavior, not new to M30. What M30
      // adds is the guarantee that the required-evidence DECISION itself
      // (the workUnitStatus downgrade to needs_review) is captured in the
      // state write that already happened before any runlog append was
      // attempted -- state remains authoritative even though the overall
      // command reports the runlog failure.
      expect(checkpointResult.status).toBe(3);
      const stateAfterFailure = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
      expect(stateAfterFailure.workGraph.workUnits[0].status).toBe("needs_review");
      expect(stateAfterFailure.checkpoints).toHaveLength(1);
      const runlogAfterFailure = readFileSync(runlogPath, "utf8");
      expect(runlogAfterFailure).not.toContain("required_decision_recorded");
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  }, 30000);

  it("the required-evidence workflow modules add no process, network, Git, or dynamic-loading surface", () => {
    const modules = [
      "required-evidence-gate.ts",
      "required-evidence-binding.ts",
      "checkpoint-required-evidence-integration.ts",
      "review-required-evidence-integration.ts",
      "required-evidence-issues.ts",
      "required-evidence-visibility.ts",
      "gate-k-activation-evaluation.ts",
      "gate-k-activation-snapshot.ts",
      "evidence-enforcement-profile-identity.ts",
    ];
    for (const mod of modules) {
      const src = readFileSync(join(repoRoot, "src", "workflow", mod), "utf8");
      expect(src).not.toMatch(/child_process|node-fetch|require\(|import\(|new Function\(|execSync|spawnSync/);
    }
  });

  it("a legacy pre-M30 state.json (no enforcement/activation/exception fields at all) remains valid for status/manage/export/review", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const state = readState(dir);
    expect("enforcementProfiles" in state).toBe(false);
    expect("requiredModeActivations" in state).toBe(false);
    expect("requiredEvidenceExceptions" in state).toBe(false);

    expect(runCli(["status", "--json"], dir).status).toBe(0);
    expect(runCli(["manage", "--json"], dir).status).toBe(0);
    const review = runCli(["review", "--json"], dir);
    expect([0, 1]).toContain(review.status);
  }, 20000);
});
