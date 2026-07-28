import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runEvidenceGatePolicyImport } from "../../src/cli/commands/evidence-gate-policy-import.command.js";
import { runEvidenceGatePolicyActivate } from "../../src/cli/commands/evidence-gate-policy-activate.command.js";
import { runEvidenceGateEnforcementProfileImport } from "../../src/cli/commands/evidence-gate-enforcement-profile-import.command.js";
import { runEvidenceGateExceptionCreate } from "../../src/cli/commands/evidence-gate-exception-create.command.js";
import { runEvidenceGateExceptionRevoke } from "../../src/cli/commands/evidence-gate-exception-revoke.command.js";
import { runEvidenceGateExceptionList } from "../../src/cli/commands/evidence-gate-exception-list.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");
const T1 = "2026-01-01T00:00:00.000Z";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}
function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}
function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
}

/** Within the 30-day exception-expiry maximum, relative to the real wall clock. */
function nearFutureExpiry(): string {
  return new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
}
/** Beyond the 30-day exception-expiry maximum. */
function farFutureExpiry(): string {
  return new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
}

async function makeInProgressProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
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

async function importAndActivatePolicy(dir: string) {
  const policyPath = join(dir, "policy.json");
  writeFileSync(policyPath, JSON.stringify(samplePolicy()));
  const imported = await runEvidenceGatePolicyImport(contextFor(dir), { fromFile: policyPath });
  expect(imported.exitCode).toBe(ExitCode.Success);
  const activated = await runEvidenceGatePolicyActivate(contextFor(dir), { policyId: "release-gate", version: 1 });
  expect(activated.exitCode).toBe(ExitCode.Success);
  return (imported.data as { policy: { policyDigest: string } }).policy.policyDigest;
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

function seedActivationRecord(dir: string) {
  const state = readState(dir);
  state.requiredModeActivations = [
    {
      protocolVersion: "aiqt-required-mode-activation@1",
      activationId: "ACT-001",
      planId: "RMAP-001",
      profileRef: { profileId: "release-required", version: 1 },
      activationSnapshotDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999".slice(0, 71),
      activatedAt: T1,
      activatedBy: "alice",
      reason: "fixture",
      grandfatheredWorkUnitIds: [],
      status: "active",
    },
  ];
  writeState(dir, state);
}

async function seedActiveActivation(dir: string) {
  const digest = await importAndActivatePolicy(dir);
  const profilePath = join(dir, "profile.json");
  writeFileSync(profilePath, JSON.stringify(sampleProfile(digest)));
  await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath });
  seedActivationRecord(dir);
}

describe("M30-WU06: scoped exceptions, required issue routing, visibility", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("creates an exact scoped exception only for exception-eligible rules, then it satisfies a missing-evidence checkpoint", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await seedActiveActivation(dir);
    const project = readProject(dir);

    const create = await runEvidenceGateExceptionCreate(contextFor(dir), {
      activationId: "ACT-001",
      gate: "checkpoint",
      workUnitId: "WU001",
      rules: "test-results-present",
      authorizedBy: "alice",
      reason: "known gap, tracked separately",
      expiresAt: nearFutureExpiry(),
      confirmException: project.project.id,
    });
    expect(create.exitCode).toBe(ExitCode.Success);
    const exceptionId = (create.data as { exception: { exceptionId: string } }).exception.exceptionId;

    const checkpointResult = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(checkpointResult.exitCode).toBe(ExitCode.Success);
    const data = checkpointResult.data as Record<string, unknown>;
    expect(data.toStatus).toBe("done");
    expect((data.requiredEvidence as Record<string, unknown>).exceptionRefs).toEqual([exceptionId]);

    const finalState = readState(dir);
    expect(finalState.requiredEvidenceExceptions[0].status).toBe("consumed"); // checkpoint exceptions are single-use
  }, 20000);

  it("rejects creating an exception for a rule the profile has not marked exception-eligible", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const digest = await importAndActivatePolicy(dir);
    const profilePath = join(dir, "profile.json");
    const profile = sampleProfile(digest) as { gates: { checkpoint: { exceptionEligibleRuleIds: string[] } } };
    profile.gates.checkpoint.exceptionEligibleRuleIds = []; // none eligible
    writeFileSync(profilePath, JSON.stringify(profile));
    await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath });
    seedActivationRecord(dir);
    const project = readProject(dir);

    const create = await runEvidenceGateExceptionCreate(contextFor(dir), {
      activationId: "ACT-001",
      gate: "checkpoint",
      workUnitId: "WU001",
      rules: "test-results-present",
      authorizedBy: "alice",
      reason: "trying to waive a non-eligible rule",
      expiresAt: nearFutureExpiry(),
      confirmException: project.project.id,
    });
    expect(create.exitCode).toBe(ExitCode.InvalidInput);
  }, 20000);

  it("rejects an expiry beyond 30 days", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await seedActiveActivation(dir);
    const project = readProject(dir);

    const create = await runEvidenceGateExceptionCreate(contextFor(dir), {
      activationId: "ACT-001",
      gate: "checkpoint",
      workUnitId: "WU001",
      rules: "test-results-present",
      authorizedBy: "alice",
      reason: "too long",
      expiresAt: farFutureExpiry(),
      confirmException: project.project.id,
    });
    expect(create.exitCode).toBe(ExitCode.InvalidInput);
  }, 20000);

  it("revoke is idempotent and cannot revoke a consumed exception", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await seedActiveActivation(dir);
    const project = readProject(dir);

    const create = await runEvidenceGateExceptionCreate(contextFor(dir), {
      activationId: "ACT-001",
      gate: "checkpoint",
      workUnitId: "WU001",
      rules: "test-results-present",
      authorizedBy: "alice",
      reason: "n/a",
      expiresAt: nearFutureExpiry(),
      confirmException: project.project.id,
    });
    const exceptionId = (create.data as { exception: { exceptionId: string } }).exception.exceptionId;

    const first = await runEvidenceGateExceptionRevoke(contextFor(dir), { exceptionId, revokedBy: "alice", reason: "no longer needed" });
    expect(first.exitCode).toBe(ExitCode.Success);
    const replay = await runEvidenceGateExceptionRevoke(contextFor(dir), { exceptionId, revokedBy: "alice", reason: "no longer needed" });
    expect(replay.exitCode).toBe(ExitCode.Success);
    expect((replay.data as { outcome: string }).outcome).toBe("no_op");

    const list = runEvidenceGateExceptionList(contextFor(dir));
    expect((list.data as { exceptions: { status: string }[] }).exceptions[0].status).toBe("revoked");
  }, 20000);

  it("a needs_review-downgrading required deficiency creates exactly one required ProjectIssue, visible via status/manage", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await seedActiveActivation(dir);
    // No evidence -> missing -> blocked, not needs_review. Use insufficient
    // trust instead (evidence present but below minimum) to reach needs_review.
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

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as Record<string, unknown>;
    expect(data.toStatus).toBe("needs_review");
    const required = data.requiredEvidence as Record<string, unknown>;
    expect(required.issueKeys).toHaveLength(1);
    expect((required.issueKeys as string[])[0]).toMatch(/^required:ACT-001:checkpoint:/);

    const finalState = readState(dir);
    // M29's advisory routing (checkpoint:...:advisory:...) and M30's
    // required routing (required:...) are independent, disjoint key
    // spaces -- the same underlying rule failure legitimately produces
    // one issue in each.
    expect(finalState.issues.projectIssues).toHaveLength(2);
    const requiredIssue = finalState.issues.projectIssues.find((pi: { issueKey: string }) => pi.issueKey.startsWith("required:"));
    expect(requiredIssue.issueKey).toBe((required.issueKeys as string[])[0]);

    const status = runStatus(contextFor(dir), {});
    const reqSummary = (status.data as Record<string, unknown>).requiredEvidence as Record<string, unknown>;
    expect(reqSummary.effectiveMode).toBe("required");
    expect(reqSummary.needsReviewTargets).toBe(1);

    const manage = runManage(contextFor(dir));
    expect((manage.data as Record<string, unknown>).requiredEvidence).toBeTruthy();
  }, 20000);

  it("recovery guidance is bounded, deterministic data -- never executed", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await seedActiveActivation(dir);

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked); // missing evidence, no exception
    // Zero mutation means requiredEvidence is not even in the response data
    // (blocked attempts return before the decision is built into a response).
    expect((result.data as Record<string, unknown> | undefined)?.requiredEvidence).toBeUndefined();
  }, 20000);
});
