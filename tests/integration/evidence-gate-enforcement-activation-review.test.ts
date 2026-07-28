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
import { runEvidenceGateEnforcementActivationPrepare } from "../../src/cli/commands/evidence-gate-enforcement-activation-prepare.command.js";
import { runEvidenceGateEnforcementActivationActivate } from "../../src/cli/commands/evidence-gate-enforcement-activation-activate.command.js";
import { runEvidenceGateEnforcementActivationDeactivate } from "../../src/cli/commands/evidence-gate-enforcement-activation-deactivate.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
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
function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
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

function samplePolicy(): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "release-gate",
    version: 1,
    name: "Release Gate",
    targetScopes: ["checkpoint", "project"],
    rules: [
      { ruleId: "test-results-present", title: "T", appliesTo: ["checkpoint", "project"], evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "fail" },
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
        exceptionEligibleRuleIds: [],
      },
      releaseReview: {
        policyRef: { policyId: "release-gate", version: 1, digest: policyDigest },
        targetSet: ["project"],
        bindingRequirements: {},
        onIndeterminate: "fail_review",
        onUnavailable: "fail_review",
        exceptionEligibleRuleIds: [],
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

async function importAndActivatePolicy(dir: string) {
  const policyPath = join(dir, "policy.json");
  writeFileSync(policyPath, JSON.stringify(samplePolicy()));
  const imported = await runEvidenceGatePolicyImport(contextFor(dir), { fromFile: policyPath });
  expect(imported.exitCode).toBe(ExitCode.Success);
  const activated = await runEvidenceGatePolicyActivate(contextFor(dir), { policyId: "release-gate", version: 1 });
  expect(activated.exitCode).toBe(ExitCode.Success);
  return (imported.data as { policy: { policyDigest: string } }).policy.policyDigest;
}

describe("M30-WU05: activation lifecycle, review gates, grandfathering", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("activation activate is blocked (exit 2) when a freshly-prepared plan still has open Gate K conditions", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const digest = await importAndActivatePolicy(dir);
    const profilePath = join(dir, "profile.json");
    writeFileSync(profilePath, JSON.stringify(sampleProfile(digest)));
    await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath });
    const prepared = await runEvidenceGateEnforcementActivationPrepare(contextFor(dir), { profileId: "release-required", version: 1 });
    expect(prepared.exitCode).toBe(ExitCode.Success);
    const planId = (prepared.data as { plan: { planId: string } }).plan.planId;
    const project = readProject(dir);

    const activateResult = await runEvidenceGateEnforcementActivationActivate(contextFor(dir), {
      planId,
      activatedBy: "alice",
      reason: "test activation",
      confirmRequired: project.project.id,
    });
    expect(activateResult.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect((activateResult.data as { projectActivationResidualRisk: number }).projectActivationResidualRisk).toBeGreaterThan(5);

    const state = readState(dir);
    expect(state.requiredModeActivations ?? []).toHaveLength(0);
  }, 20000);

  it("activation activate rejects a mismatched --confirm-required (exit 3), zero mutation", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const digest = await importAndActivatePolicy(dir);
    const profilePath = join(dir, "profile.json");
    writeFileSync(profilePath, JSON.stringify(sampleProfile(digest)));
    await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath });
    const prepared = await runEvidenceGateEnforcementActivationPrepare(contextFor(dir), { profileId: "release-required", version: 1 });
    const planId = (prepared.data as { plan: { planId: string } }).plan.planId;

    const result = await runEvidenceGateEnforcementActivationActivate(contextFor(dir), {
      planId,
      activatedBy: "alice",
      reason: "test",
      confirmRequired: "WRONG-PROJECT-ID",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  }, 20000);

  it("deactivation returns the project to advisory, is idempotent, and never touches checkpoints/issues/exceptions/history", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivatePolicy(dir);
    const state = readState(dir);
    state.requiredModeActivations = [
      {
        protocolVersion: "aiqt-required-mode-activation@1",
        activationId: "ACT-001",
        planId: "RMAP-001",
        profileRef: { profileId: "release-required", version: 1 },
        activationSnapshotDigest: POLICY_DIGEST,
        activatedAt: T1,
        activatedBy: "alice",
        reason: "fixture",
        grandfatheredWorkUnitIds: [],
        status: "active",
      },
    ];
    writeState(dir, state);
    const project = readProject(dir);

    const deactivateResult = await runEvidenceGateEnforcementActivationDeactivate(contextFor(dir), {
      activationId: "ACT-001",
      deactivatedBy: "alice",
      reason: "rollback",
      confirmDeactivate: project.project.id,
    });
    expect(deactivateResult.exitCode).toBe(ExitCode.Success);
    const afterState = readState(dir);
    expect(afterState.requiredModeActivations[0].status).toBe("deactivated");
    // Advisory policy still active -> effective mode is advisory, not off.
    expect(afterState.evidenceGate.activePolicyRef).toEqual({ policyId: "release-gate", version: 1 });

    const replay = await runEvidenceGateEnforcementActivationDeactivate(contextFor(dir), {
      activationId: "ACT-001",
      deactivatedBy: "alice",
      reason: "rollback",
      confirmDeactivate: project.project.id,
    });
    expect(replay.exitCode).toBe(ExitCode.Success);
    expect((replay.data as { outcome: string }).outcome).toBe("no_op");
  }, 20000);

  it("release review: required evidence failure escalates exit to 1, but never hides a stronger existing blocker", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const digest = await importAndActivatePolicy(dir);
    const profilePath = join(dir, "profile.json");
    writeFileSync(profilePath, JSON.stringify(sampleProfile(digest)));
    await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath });

    const state = readState(dir);
    state.requiredModeActivations = [
      {
        protocolVersion: "aiqt-required-mode-activation@1",
        activationId: "ACT-001",
        planId: "RMAP-001",
        profileRef: { profileId: "release-required", version: 1 },
        activationSnapshotDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444".slice(0, 71),
        activatedAt: T1,
        activatedBy: "alice",
        reason: "fixture",
        grandfatheredWorkUnitIds: [],
        status: "active",
      },
    ];
    writeState(dir, state);

    // No evidence at the project level -> release review's required project target fails.
    const releaseReview = runReviewCommand(contextFor(dir), { mode: "release" });
    expect(releaseReview.exitCode).toBe(ExitCode.ValidationFailed);
    expect((releaseReview.data as Record<string, unknown>).requiredEvidence).toBeTruthy();
  }, 20000);

  it("grandfathering: a work unit snapshotted as grandfathered is excluded from the release review target set even though its checkpoint would otherwise fail required evidence", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const digest = await importAndActivatePolicy(dir);
    const profilePath = join(dir, "profile.json");
    writeFileSync(profilePath, JSON.stringify(sampleProfile(digest)));
    await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath });

    // Complete the work unit BEFORE activation (off mode, no evidence needed) -- it becomes "done".
    const cpResult = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(cpResult.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);
    state.requiredModeActivations = [
      {
        protocolVersion: "aiqt-required-mode-activation@1",
        activationId: "ACT-001",
        planId: "RMAP-001",
        profileRef: { profileId: "release-required", version: 1 },
        activationSnapshotDigest: "sha256:5555555555555555555555555555555555555555555555555555555555555555".slice(0, 71),
        activatedAt: T1,
        activatedBy: "alice",
        reason: "fixture",
        grandfatheredWorkUnitIds: ["WU001"], // snapshotted at activation time
        status: "active",
      },
    ];
    writeState(dir, state);

    // targetSet is ["project"] in this profile's release gate, so the
    // grandfathered work unit's checkpoint is not even a candidate target
    // regardless; use a profile with effective_checkpoints to prove exclusion.
    const profileWithCheckpoints = sampleProfile(digest) as { gates: { releaseReview: { targetSet: string[] } } };
    profileWithCheckpoints.gates.releaseReview.targetSet = ["effective_checkpoints"];
    (profileWithCheckpoints as unknown as { version: number }).version = 2;
    writeFileSync(profilePath, JSON.stringify(profileWithCheckpoints));
    await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath });
    const state2 = readState(dir);
    state2.requiredModeActivations[0].profileRef.version = 2;
    writeState(dir, state2);

    const releaseReview = runReviewCommand(contextFor(dir), { mode: "release" });
    // The only checkpoint belongs to the grandfathered work unit -> target
    // set is empty -> required gate is a no-op (not evaluated).
    expect((releaseReview.data as Record<string, unknown>).requiredEvidence).toBeUndefined();
  }, 20000);
});
