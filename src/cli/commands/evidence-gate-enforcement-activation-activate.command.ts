import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildRequiredModeActivatedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { nextId } from "../../state/ids.js";
import { findActivationPlan, findEnforcementProfile, getActiveActivation, getEnforcementProfiles, getRequiredModeActivations } from "../../services/evidence-enforcement-service.js";
import { findPolicy, getEvidenceGatePolicies } from "../../services/evidence-gate-policy-service.js";
import { evaluateGateKConditions } from "../../workflow/gate-k-activation-evaluation.js";
import { computeActivationSnapshotDigest } from "../../workflow/gate-k-activation-snapshot.js";
import { ACTIVATION_RESIDUAL_RISK_MAXIMUM_FOR_ACTIVATION } from "../../schema/required-mode-activation-plan.schema.js";
import type { RequiredModeActivation } from "../../schema/required-mode-activation.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateEnforcementActivationActivateOptions {
  planId?: string;
  activatedBy?: string;
  reason?: string;
  confirmRequired?: string;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return makeResult({
    status: exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed",
    action: "evidence",
    summary,
    exitCode,
    blockingIssues: [{ id: issueId, severity: "high", area: "evidence-gate", message: summary, agentCanFix: false }],
  });
}

/**
 * aiqt evidence gate enforcement activation activate --plan --activated-by
 * --reason --confirm-required <project-id> [--json] (M30 §5.3): the sole
 * boundary that turns required mode on. Requires a non-expired plan,
 * matching current activation snapshot digest, zero blockers, computed
 * project activation residual risk <=5, exact project confirmation, and
 * no current active activation -- re-verified fresh against live state,
 * never trusting the plan's stored numbers alone.
 */
export async function runEvidenceGateEnforcementActivationActivate(
  ctx: CommandContext,
  options: RunEvidenceGateEnforcementActivationActivateOptions,
): Promise<CommandResult> {
  try {
    if (!options.planId) {
      return failure("aiqt evidence gate enforcement activation activate requires --plan <plan-id>.", ExitCode.HumanInputRequired, "ACTIVATION-ACTIVATE-NO-PLAN");
    }
    if (!options.activatedBy || !options.reason || !options.confirmRequired) {
      return failure("aiqt evidence gate enforcement activation activate requires --activated-by, --reason, and --confirm-required <project-id>.", ExitCode.HumanInputRequired, "ACTIVATION-ACTIVATE-MISSING-HUMAN-INPUT");
    }

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ACTIVATION-ACTIVATE-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    if (options.confirmRequired !== project.project.id) {
      return failure(`--confirm-required must exactly match the current project id ("${project.project.id}").`, ExitCode.InvalidInput, "ACTIVATION-ACTIVATE-CONFIRMATION-MISMATCH");
    }

    const plan = findActivationPlan(options.planId, state);
    if (!plan) {
      return failure(`No activation plan "${options.planId}" exists.`, ExitCode.InvalidInput, "ACTIVATION-ACTIVATE-UNKNOWN-PLAN");
    }

    if (getActiveActivation(state)) {
      return failure("A required-mode activation is already active for this project. Deactivate it first.", ExitCode.WorkflowBlocked, "ACTIVATION-ACTIVATE-ALREADY-ACTIVE");
    }

    const profile = findEnforcementProfile(plan.profileRef.profileId, plan.profileRef.version, getEnforcementProfiles(state));
    if (!profile || !profile.gates.checkpoint) {
      return failure("The plan's referenced enforcement profile no longer exists or has no checkpoint gate.", ExitCode.InvalidInput, "ACTIVATION-ACTIVATE-PROFILE-MISSING");
    }
    const policy = findPolicy(profile.gates.checkpoint.policyRef.policyId, profile.gates.checkpoint.policyRef.version, getEvidenceGatePolicies(state));
    if (!policy || policy.policyDigest !== profile.gates.checkpoint.policyRef.digest) {
      return failure("The profile's referenced policy could not be found or its digest does not match.", ExitCode.InvalidInput, "ACTIVATION-ACTIVATE-POLICY-MISMATCH");
    }

    const now = new Date().toISOString();

    if (new Date(plan.expiresAt).getTime() <= new Date(now).getTime()) {
      return failure(`Activation plan "${plan.planId}" has expired.`, ExitCode.WorkflowBlocked, "ACTIVATION-ACTIVATE-PLAN-EXPIRED");
    }

    const currentSnapshotDigest = computeActivationSnapshotDigest({
      state,
      profileId: profile.profileId,
      profileVersion: profile.version,
      profileDigest: profile.profileDigest,
      policyId: policy.policyId,
      policyVersion: policy.version,
      policyDigest: policy.policyDigest,
      grandfatheredWorkUnitIds: plan.grandfatheredWorkUnitIds,
    });

    const evaluation = evaluateGateKConditions({
      state,
      runlogFile: paths.runlogFile,
      profile,
      policy,
      humanInputs: { activatedBy: options.activatedBy, reason: options.reason, confirmProjectId: options.confirmRequired, projectId: project.project.id },
      existingPlan: { activationSnapshotDigest: plan.activationSnapshotDigest, expiresAt: plan.expiresAt, generatedAtCheckDigest: currentSnapshotDigest },
      now,
    });

    if (evaluation.blockers.length > 0 || evaluation.projectActivationResidualRisk > ACTIVATION_RESIDUAL_RISK_MAXIMUM_FOR_ACTIVATION) {
      return makeResult({
        status: "blocked",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Activation blocked: risk ${evaluation.projectActivationResidualRisk}/100 (maximum ${ACTIVATION_RESIDUAL_RISK_MAXIMUM_FOR_ACTIVATION}), ${evaluation.blockers.length} blocker(s).`,
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: evaluation.blockers.map((b, i) => ({ id: `ACTIVATION-ACTIVATE-BLOCKER-${i}`, severity: "high" as const, area: "evidence-gate", message: b, agentCanFix: false })),
        data: { projectActivationResidualRisk: evaluation.projectActivationResidualRisk, blockers: evaluation.blockers },
      });
    }

    const activations = getRequiredModeActivations(state);
    const activationId = nextId("RMA", activations.map((a) => a.activationId));
    const activation: RequiredModeActivation = {
      protocolVersion: "aiqt-required-mode-activation@1",
      activationId,
      planId: plan.planId,
      profileRef: { profileId: profile.profileId, version: profile.version },
      activationSnapshotDigest: currentSnapshotDigest,
      activatedAt: now,
      activatedBy: options.activatedBy,
      reason: options.reason,
      grandfatheredWorkUnitIds: plan.grandfatheredWorkUnitIds,
      status: "active",
    };

    const finalState: StateModel = { ...state, requiredModeActivations: [...activations, activation] };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildRequiredModeActivatedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [activationId, plan.planId, project.project.id],
          data: { activationId, planId: plan.planId, profileId: profile.profileId, profileVersion: profile.version, activatedBy: options.activatedBy },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying is idempotent.`,
        ExitCode.InvalidInput,
        "ACTIVATION-ACTIVATE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Required mode activated: ${activationId} (profile ${profile.profileId} v${profile.version}). ${activation.grandfatheredWorkUnitIds.length} Work Unit(s) grandfathered.`,
      completedActions: ["Re-verified Gate K conditions", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [activationId],
      exitCode: ExitCode.Success,
      data: { activation, outcome: "activated" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "ACTIVATION-ACTIVATE-UNEXPECTED-ERROR");
  }
}
