import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runCheckpointAmend } from "../../src/cli/commands/checkpoint-amend.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");
const T1 = "2026-01-01T00:00:00.000Z";
const POLICY_DIGEST = "sha256:1111111111111111111111111111111111111111111111111111111111111111".slice(0, 71);

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}
function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}
function readRunlogLines(dir: string): { type: string; data?: Record<string, unknown> }[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((l) => JSON.parse(l));
}

async function makeInProgressProject(dir: string, planFixture = "valid-plan.json") {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, planFixture)));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

function seedRequiredPolicyAndActivation(dir: string, options: { onIndeterminate?: "needs_review" | "block"; onUnavailable?: "needs_review" | "block"; exceptionEligibleRuleIds?: string[] } = {}) {
  const state = readState(dir);
  state.evidenceGate = {
    policies: [
      {
        protocolVersion: "aiqt-evidence-gate-policy@1",
        policyId: "release-gate",
        version: 1,
        name: "Release Gate",
        targetScopes: ["checkpoint"],
        rules: [
          { ruleId: "test-results-present", title: "T", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "fail" },
        ],
        policyDigest: POLICY_DIGEST,
        createdAt: T1,
      },
    ],
    activePolicyRef: { policyId: "release-gate", version: 1 },
  };
  state.enforcementProfiles = [
    {
      protocolVersion: "aiqt-evidence-enforcement-profile@1",
      profileId: "release-required",
      version: 1,
      name: "Release Required",
      gates: {
        checkpoint: {
          policyRef: { policyId: "release-gate", version: 1, digest: POLICY_DIGEST },
          bindingRequirements: { workUnit: "required" },
          onFail: "needs_review",
          onIndeterminate: options.onIndeterminate ?? "needs_review",
          onUnavailable: options.onUnavailable ?? "needs_review",
          exceptionEligibleRuleIds: options.exceptionEligibleRuleIds ?? [],
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
      profileDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222".slice(0, 71),
      createdAt: T1,
    },
  ];
  state.requiredModeActivations = [
    {
      protocolVersion: "aiqt-required-mode-activation@1",
      activationId: "ACT-001",
      planId: "RMAP-001",
      profileRef: { profileId: "release-required", version: 1 },
      activationSnapshotDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333".slice(0, 71),
      activatedAt: T1,
      activatedBy: "alice",
      reason: "test fixture",
      grandfatheredWorkUnitIds: [],
      status: "active",
    },
  ];
  writeState(dir, state);
}

function seedTestResultEvidence(dir: string, checkpointId: string, workUnitId: string) {
  const state = readState(dir);
  state.evidence = {
    records: [
      {
        evidenceId: "EVD-1",
        contractVersion: "1.0",
        provider: { providerId: "human", providerType: "human", trustLevel: "repository_local" },
        workflowBinding: { workUnitId, packetId: state.lastAgentPacket.id, checkpointId, implementationRootId: "ROOT-001" },
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
}

describe("M30-WU04: checkpoint/amendment required-evidence enforcement", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("required + allow: evidence present -> checkpoint becomes done (exit 0), decision recorded", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    seedRequiredPolicyAndActivation(dir);
    seedTestResultEvidence(dir, "C001", "WU001");

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as Record<string, unknown>;
    expect(data.toStatus).toBe("done");
    expect((data.requiredEvidence as Record<string, unknown>).outcome).toBe("allow");

    const events = readRunlogLines(dir).map((e) => e.type);
    expect(events).toContain("evidence_gate.required_decision_recorded");
  }, 20000);

  it("required + missing evidence, no exception -> checkpoint BLOCKED (exit 2), zero mutation", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    seedRequiredPolicyAndActivation(dir);
    const beforeState = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const beforeRunlog = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforeState);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(beforeRunlog);
  }, 20000);

  it("required + missing evidence WITH a valid eligible exception -> allow (done, exit 0), exception consumed", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    seedRequiredPolicyAndActivation(dir, { exceptionEligibleRuleIds: ["test-results-present"] });
    const state = readState(dir);
    state.requiredEvidenceExceptions = [
      {
        protocolVersion: "aiqt-required-evidence-exception@1",
        exceptionId: "EXC-1",
        activationId: "ACT-001",
        gate: "checkpoint",
        scope: { projectId: state.workGraph.workUnits[0] ? undefined : undefined, workUnitId: "WU001" },
        policyDigest: POLICY_DIGEST,
        ruleIds: ["test-results-present"],
        authorizedBy: "alice",
        reason: "known gap",
        createdAt: T1,
        expiresAt: "2099-01-01T00:00:00.000Z",
        usage: { mode: "single_use" },
        status: "active",
      },
    ];
    // projectId must match; read the real project id.
    const project = JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
    state.requiredEvidenceExceptions[0].scope.projectId = project.project.id;
    writeState(dir, state);

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as Record<string, unknown>;
    expect(data.toStatus).toBe("done");
    expect((data.requiredEvidence as Record<string, unknown>).exceptionRefs).toEqual(["EXC-1"]);

    const finalState = readState(dir);
    expect(finalState.requiredEvidenceExceptions[0].status).toBe("consumed");
  }, 20000);

  it("required + indeterminate rule + onIndeterminate=block -> checkpoint UNCHANGED (exit 2), zero mutation", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const state0 = readState(dir);
    state0.evidenceGate = {
      policies: [
        {
          protocolVersion: "aiqt-evidence-gate-policy@1",
          policyId: "release-gate",
          version: 1,
          name: "Release Gate",
          targetScopes: ["checkpoint"],
          rules: [{ ruleId: "ci-run-present", title: "T", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "indeterminate" }],
          policyDigest: POLICY_DIGEST,
          createdAt: T1,
        },
      ],
      activePolicyRef: { policyId: "release-gate", version: 1 },
    };
    writeState(dir, state0);
    seedRequiredPolicyAndActivation(dir, { onIndeterminate: "block" });
    // seedRequiredPolicyAndActivation overwrote evidenceGate.policies -- restore indeterminate rule policy digest match by re-seeding after.
    const state = readState(dir);
    state.evidenceGate.policies[0].rules = [{ ruleId: "ci-run-present", title: "T", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "indeterminate" }];
    writeState(dir, state);

    const beforeState = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforeState);
  }, 20000);

  it("required + binding mismatch (evidence bound to a different work unit) -> INVALID (exit 3), zero mutation", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    seedRequiredPolicyAndActivation(dir);
    seedTestResultEvidence(dir, "C001", "WU999"); // wrong work unit
    const beforeState = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(beforeState);
  }, 20000);

  it("existing-result precedence: a checkpoint that already fails its own acceptance/validation stays needs_review, never reaching the required gate", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    seedRequiredPolicyAndActivation(dir);
    // No evidence at all -- if the required gate ran, it would block. It must never run because this checkpoint's OWN result is needs_review already.
    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-needs-review.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as Record<string, unknown>;
    expect(data.toStatus).toBe("needs_review");
    expect(data.requiredEvidence).toBeUndefined();
  }, 20000);

  it("off/advisory parity: no activation at all -> checkpoint completion identical to pre-M30 (done, exit 0), no required-evidence field", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    // No evidenceGate, no enforcementProfiles, no activation at all -- "off" mode.
    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as Record<string, unknown>;
    expect(data.toStatus).toBe("done");
    expect(data.requiredEvidence).toBeUndefined();
  }, 20000);

  it("amendment: required gate downgrades needs_review -> done back to needs_review when evidence exists but fails a profile-fail-behavior deficiency (insufficient trust)", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const cpResult = runCheckpoint(contextFor(dir), {
      input: {
        summary: "Aggregate result awaits amendment.", completed: ["Application implementation"], notCompleted: [], filesChanged: [], issues: [],
        validationResult: "partial", acceptanceCriteriaResult: "partial",
        validationCommands: [{ command: "pnpm test", result: "passed" }, { command: "pnpm build", result: "passed" }],
        acceptanceCriteria: [{ criterion: "Application starts successfully", result: "passed" }],
        targetStatus: "needs_review", notes: [],
      },
    });
    expect(cpResult.exitCode).toBe(ExitCode.Success);
    seedRequiredPolicyAndActivation(dir);
    // Evidence exists (so the deficiency is "insufficient_trust", governed by
    // onFail=needs_review) rather than "missing" (which always blocks
    // regardless of onFail, per the transition matrix's own distinction).
    const state = readState(dir);
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

    const amendResult = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C001",
      acceptance: "passed",
      validation: "passed",
      reason: "Attempting completion without evidence.",
    });
    expect(amendResult.exitCode).toBe(ExitCode.Success);
    const data = amendResult.data as Record<string, unknown>;
    expect(data.workUnitStatusAfter).toBe("needs_review"); // downgraded, not done
    expect(data.changed).toBe(true); // the amendment overlay is still stored

    const finalState = readState(dir);
    expect(finalState.checkpointAmendments ?? []).toHaveLength(0);
    expect(finalState.reviewRecords).toHaveLength(1);
    expect(finalState.reviewRecords[0]).toMatchObject({
      checkpointId: "C001",
      acceptanceCriteriaResult: "passed",
      validationResult: "passed",
      decision: "accepted",
    });
    expect(finalState.workGraph.workUnits[0].status).toBe("needs_review");
  }, 20000);

  it("amendment: required gate allows needs_review -> done when evidence is present", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const cpResult = runCheckpoint(contextFor(dir), {
      input: {
        summary: "Aggregate result awaits amendment.", completed: ["Application implementation"], notCompleted: [], filesChanged: [], issues: [],
        validationResult: "partial", acceptanceCriteriaResult: "partial",
        validationCommands: [{ command: "pnpm test", result: "passed" }, { command: "pnpm build", result: "passed" }],
        acceptanceCriteria: [{ criterion: "Application starts successfully", result: "passed" }],
        targetStatus: "needs_review", notes: [],
      },
    });
    expect(cpResult.exitCode).toBe(ExitCode.Success);
    seedRequiredPolicyAndActivation(dir);
    seedTestResultEvidence(dir, "C001", "WU001");

    const amendResult = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C001",
      acceptance: "passed",
      validation: "passed",
      reason: "Evidence attached.",
    });
    expect(amendResult.exitCode).toBe(ExitCode.Success);
    const data = amendResult.data as Record<string, unknown>;
    expect(data.workUnitStatusAfter).toBe("done");

    const state = readState(dir);
    expect(state.workGraph.workUnits[0].status).toBe("done");
  }, 20000);
});
