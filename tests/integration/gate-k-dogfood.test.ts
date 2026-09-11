import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runCheckpointAmend } from "../../src/cli/commands/checkpoint-amend.command.js";
import { runEvidenceGatePolicyImport } from "../../src/cli/commands/evidence-gate-policy-import.command.js";
import { runEvidenceGatePolicyActivate } from "../../src/cli/commands/evidence-gate-policy-activate.command.js";
import { runEvidenceGateEnforcementProfileImport } from "../../src/cli/commands/evidence-gate-enforcement-profile-import.command.js";
import { runEvidenceGateEnforcementRecoveryImport } from "../../src/cli/commands/evidence-gate-enforcement-recovery-import.command.js";
import { runEvidenceGateEnforcementActivationPrepare } from "../../src/cli/commands/evidence-gate-enforcement-activation-prepare.command.js";
import { runEvidenceGateEnforcementActivationActivate } from "../../src/cli/commands/evidence-gate-enforcement-activation-activate.command.js";
import { runEvidenceGateEnforcementActivationDeactivate } from "../../src/cli/commands/evidence-gate-enforcement-activation-deactivate.command.js";
import { runEvidenceGateAdvisoryFeedback } from "../../src/cli/commands/evidence-gate-advisory-feedback.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";


function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}
function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}
function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
}

const SIX_WORK_UNIT_PLAN = {
  milestones: [{ clientKey: "m1", title: "Gate K Dogfood", objective: "O" }],
  workUnits: [1, 2, 3, 4, 5, 6].map((n) => ({
    clientKey: `wu${n}`,
    milestoneClientKey: "m1",
    title: `WU${n}`,
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["true"],
  })),
  dependencies: [],
};

async function makeProjectWithSixIndependentWorkUnits(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(SIX_WORK_UNIT_PLAN));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
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

function attachEvidence(dir: string, checkpointId: string, workUnitId: string, evidenceId: string) {
  const state = readState(dir);
  const records = state.evidence?.records ?? [];
  records.push({
    evidenceId,
    contractVersion: "1.0",
    provider: { providerId: "human", providerType: "human", trustLevel: "repository_local" },
    workflowBinding: { workUnitId, packetId: state.lastAgentPacket.id, checkpointId, implementationRootId: "ROOT-001" },
    codeBinding: { capturedAt: state.lastUpdatedAt },
    reviewer: { reviewerType: "human", independentContext: "unknown" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    sourceFindings: [],
    decisionEscalationIds: [],
    artifactReferences: [{ artifactId: `ART-${evidenceId}`, kind: "test_result", locator: "https://example.test/1" }],
    recordedAt: state.lastUpdatedAt,
  });
  state.evidence = { records, decisionEscalations: [] };
  writeState(dir, state);
}

function doneCheckpointFixture(dir: string, notes = "done") {
  const path = join(dir, `cp-${notes}.json`);
  writeFileSync(
    path,
    JSON.stringify({ summary: notes, completed: ["a"], notCompleted: [], filesChanged: [], issues: [], validationResult: "passed", acceptanceCriteriaResult: "passed", validationCommands: [{ command: "true", result: "passed" }], acceptanceCriteria: [{ criterion: "a", result: "passed" }], targetStatus: "done" }),
  );
  return path;
}

describe("M30-WU07: Gate K dogfood (disposable project activation)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("a project satisfying every Gate K condition activates successfully (risk 0); an incomplete advisory period, missing recovery proof, and snapshot drift each block first", async () => {
    dir = makeTempDir();
    await makeProjectWithSixIndependentWorkUnits(dir);

    // WU1: next -> attach evidence -> done (pass).
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    attachEvidence(dir, "C001", "WU001", "EVD-1");
    expect(runCheckpoint(contextFor(dir), { fromFile: doneCheckpointFixture(dir, "wu1") }).exitCode).toBe(ExitCode.Success);

    // --- First: verify activation is blocked with an incomplete advisory period (only 1 observation so far) ---
    const digest0 = (await (async () => {
      const policyPath = join(dir!, "policy.json");
      writeFileSync(policyPath, JSON.stringify(samplePolicy()));
      const imported = await runEvidenceGatePolicyImport(contextFor(dir!), { fromFile: policyPath });
      expect(imported.exitCode).toBe(ExitCode.Success);
      const activated = await runEvidenceGatePolicyActivate(contextFor(dir!), { policyId: "release-gate", version: 1 });
      expect(activated.exitCode).toBe(ExitCode.Success);
      return (imported.data as { policy: { policyDigest: string } }).policy.policyDigest;
    })());
    const profilePath = join(dir, "profile.json");
    writeFileSync(profilePath, JSON.stringify(sampleProfile(digest0)));
    expect((await runEvidenceGateEnforcementProfileImport(contextFor(dir), { fromFile: profilePath })).exitCode).toBe(ExitCode.Success);

    const earlyPrepare = await runEvidenceGateEnforcementActivationPrepare(contextFor(dir), { profileId: "release-required", version: 1 });
    expect(earlyPrepare.exitCode).toBe(ExitCode.Success);
    const earlyPlan = (earlyPrepare.data as { plan: { blockers: string[]; projectActivationResidualRisk: number } }).plan;
    expect(earlyPlan.projectActivationResidualRisk).toBeGreaterThan(5);
    expect(earlyPlan.blockers.some((b) => b.toLowerCase().includes("advisory period"))).toBe(true);

    // WU2, WU3, WU4: three more passing checkpoints with the policy now
    // active -> 3 total "evaluated" advisory observations (WU1's own
    // checkpoint predates policy activation, so its advisory was
    // "not_configured" and does not count toward the advisory period).
    for (const [wu, cp, ev] of [
      ["WU002", "C002", "EVD-2"],
      ["WU003", "C003", "EVD-3"],
      ["WU004", "C004", "EVD-4"],
    ] as const) {
      expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
      attachEvidence(dir, cp, wu, ev);
      expect(runCheckpoint(contextFor(dir), { fromFile: doneCheckpointFixture(dir, wu) }).exitCode).toBe(ExitCode.Success);
    }

    // --- Second: verify activation is blocked with a missing recovery proof (advisory period now complete, but no recovery proof imported yet) ---
    const midPrepare = await runEvidenceGateEnforcementActivationPrepare(contextFor(dir), { profileId: "release-required", version: 1 });
    const midPlan = (midPrepare.data as { plan: { blockers: string[]; projectActivationResidualRisk: number } }).plan;
    expect(midPlan.blockers.some((b) => b.toLowerCase().includes("recovery proof"))).toBe(true);
    expect(midPlan.blockers.some((b) => b.toLowerCase().includes("advisory period"))).toBe(false);

    // WU5: needs_review with evidence already attached (evidence presence is independent of the checkpoint's own accept/validation fields), then amended to done -> amendment-triggered advisory observation.
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    attachEvidence(dir, "C005", "WU005", "EVD-5");
    const needsReviewFixture = join(dir, "cp-wu5-needs-review.json");
    writeFileSync(
      needsReviewFixture,
      JSON.stringify({ summary: "partial", completed: ["a"], notCompleted: [], filesChanged: [], issues: [], validationResult: "partial", acceptanceCriteriaResult: "partial", validationCommands: [{ command: "true", result: "passed" }], acceptanceCriteria: [{ criterion: "a", result: "passed" }], targetStatus: "needs_review" }),
    );
    expect(runCheckpoint(contextFor(dir), { fromFile: needsReviewFixture }).exitCode).toBe(ExitCode.Success);
    const amendResult = runCheckpointAmend(contextFor(dir), { checkpointId: "C005", acceptance: "passed", validation: "passed", reason: "Evidence already attached; completing." });
    expect(amendResult.exitCode).toBe(ExitCode.Success);
    expect((amendResult.data as Record<string, unknown>).workUnitStatusAfter).toBe("done");

    // WU6: done with NO evidence -> fail advisory -> 1 advisory ProjectIssue; classify it to keep unclassified at 0.
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    const wu6Result = runCheckpoint(contextFor(dir), { fromFile: doneCheckpointFixture(dir, "wu6") });
    expect(wu6Result.exitCode).toBe(ExitCode.Success);
    expect(((wu6Result.data as Record<string, unknown>).evidenceAdvisory as Record<string, unknown>).result).toBe("fail");
    const afterWu6State = readState(dir);
    const advisoryIssueKey = afterWu6State.issues.projectIssues.find((pi: { issueKey: string }) => pi.issueKey.includes(":advisory:")).issueKey;
    const feedback = await runEvidenceGateAdvisoryFeedback(contextFor(dir), { issueKey: advisoryIssueKey, classification: "confirmed", rationale: "Genuine gap for WU6; tracked separately." });
    expect(feedback.exitCode).toBe(ExitCode.Success);

    // Import the recovery proof: before = fail (WU6's real checkpoint, no
    // evidence), after = pass (the SAME target, with evidence temporarily
    // attached only long enough to capture the "after" report -- then
    // reverted so WU6 remains a legitimate real fail exemplar in this
    // project's history). Both reports are real M28 simulation output via
    // the CLI's own simulate command, same target both times, per §4.5's
    // "same policy, rule, target" requirement.
    const { runEvidenceGateSimulate } = await import("../../src/cli/commands/evidence-gate-simulate.command.js");
    const beforeReportPath = join(dir, "before.json");
    const afterReportPath = join(dir, "after.json");
    const wu6AsOf = readState(dir).checkpoints.find((c: { id: string }) => c.id === "C006").createdAt;
    const beforeSim = runEvidenceGateSimulate(contextFor(dir), { checkpointId: "C006", output: beforeReportPath, asOf: wu6AsOf });
    expect(beforeSim.exitCode).toBe(ExitCode.Success);
    expect((beforeSim.data as { simulation: { overallResult: string } }).simulation.overallResult).toBe("fail");

    const stateBeforeTempEvidence = readState(dir);
    attachEvidence(dir, "C006", "WU006", "EVD-6-TEMP");
    const afterSim = runEvidenceGateSimulate(contextFor(dir), { checkpointId: "C006", output: afterReportPath, asOf: wu6AsOf });
    expect(afterSim.exitCode).toBe(ExitCode.Success);
    expect((afterSim.data as { simulation: { overallResult: string } }).simulation.overallResult).toBe("pass");
    writeState(dir, stateBeforeTempEvidence); // revert -- WU6 stays a real, evidence-free fail

    const recoveryImport = await runEvidenceGateEnforcementRecoveryImport(contextFor(dir), {
      profileId: "release-required",
      version: 1,
      gate: "checkpoint",
      ruleId: "test-results-present",
      beforeFile: beforeReportPath,
      afterFile: afterReportPath,
      recoveryKind: "evidence_import",
    });
    expect(recoveryImport.exitCode).toBe(ExitCode.Success);

    // --- Third: prepare again -- every Gate K condition except human-input/snapshot-currency (both trivially satisfied at activate time) should now be closed. ---
    const finalPrepare = await runEvidenceGateEnforcementActivationPrepare(contextFor(dir), { profileId: "release-required", version: 1 });
    expect(finalPrepare.exitCode).toBe(ExitCode.Success);
    const finalPlan = (finalPrepare.data as { plan: { planId: string; blockers: string[]; projectActivationResidualRisk: number } }).plan;
    // Only the not-yet-supplied human-input condition remains open at prepare time (weight 12).
    expect(finalPlan.projectActivationResidualRisk).toBe(12);
    expect(finalPlan.blockers).toEqual(["Explicit human activation identity, reason, and project confirmation are required."]);

    const project = readProject(dir);

    // --- Snapshot drift: any relevant state change after prepare invalidates the plan (the activation snapshot digest covers feedback classification state). ---
    const stateBeforeDrift = readState(dir);
    const driftState = readState(dir);
    driftState.evidenceAdvisoryFeedback[0].classification = "false_positive";
    writeState(dir, driftState);
    const driftActivate = await runEvidenceGateEnforcementActivationActivate(contextFor(dir), {
      planId: finalPlan.planId,
      activatedBy: "alice",
      reason: "attempt during drift",
      confirmRequired: project.project.id,
    });
    expect(driftActivate.exitCode).toBe(ExitCode.WorkflowBlocked);
    // Revert the drift exactly.
    writeState(dir, stateBeforeDrift);

    // --- Real activation succeeds now that every condition is closed. ---
    const activateResult = await runEvidenceGateEnforcementActivationActivate(contextFor(dir), {
      planId: finalPlan.planId,
      activatedBy: "alice",
      reason: "All Gate K conditions satisfied.",
      confirmRequired: project.project.id,
    });
    expect(activateResult.exitCode).toBe(ExitCode.Success);
    const activation = (activateResult.data as { activation: { activationId: string; grandfatheredWorkUnitIds: string[] } }).activation;
    expect(activation.grandfatheredWorkUnitIds.sort()).toEqual(["WU001", "WU002", "WU003", "WU004", "WU005", "WU006"]);

    const stateAfterActivation = readState(dir);
    expect(stateAfterActivation.requiredModeActivations).toHaveLength(1);
    expect(stateAfterActivation.requiredModeActivations[0].status).toBe("active");

    // --- Explicit deactivation recovers. ---
    const deactivateResult = await runEvidenceGateEnforcementActivationDeactivate(contextFor(dir), {
      activationId: activation.activationId,
      deactivatedBy: "alice",
      reason: "rollback for test cleanliness",
      confirmDeactivate: project.project.id,
    });
    expect(deactivateResult.exitCode).toBe(ExitCode.Success);
    const finalState = readState(dir);
    expect(finalState.requiredModeActivations[0].status).toBe("deactivated");
  }, 30000);
});
