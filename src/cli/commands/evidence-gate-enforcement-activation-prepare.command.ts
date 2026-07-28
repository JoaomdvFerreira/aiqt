import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildActivationPlanPreparedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { nextId } from "../../state/ids.js";
import { findEnforcementProfile, findLatestEnforcementProfileVersion, getActivationPlans, getEnforcementProfiles } from "../../services/evidence-enforcement-service.js";
import { findPolicy, getEvidenceGatePolicies } from "../../services/evidence-gate-policy-service.js";
import { evaluateGateKConditions } from "../../workflow/gate-k-activation-evaluation.js";
import { computeActivationSnapshotDigest } from "../../workflow/gate-k-activation-snapshot.js";
import { ACTIVATION_PLAN_EXPIRY_SECONDS, MAX_ACTIVATION_PLANS, type RequiredModeActivationPlan } from "../../schema/required-mode-activation-plan.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateEnforcementActivationPrepareOptions {
  profileId?: string;
  version?: number;
  preview?: boolean;
  asOf?: string;
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

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * aiqt evidence gate enforcement activation prepare --profile --version
 * [--preview] [--json] (M30 §5.3): computes a bounded, replay-safe
 * activation plan -- exact §4.6.1 residual-risk formula, deterministic
 * grandfathering snapshot -- and NEVER activates enforcement.
 */
export async function runEvidenceGateEnforcementActivationPrepare(
  ctx: CommandContext,
  options: RunEvidenceGateEnforcementActivationPrepareOptions,
): Promise<CommandResult> {
  try {
    if (!options.profileId) {
      return failure("aiqt evidence gate enforcement activation prepare requires --profile <id> and --version <n>.", ExitCode.HumanInputRequired, "ACTIVATION-PREPARE-NO-PROFILE");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "ACTIVATION-PREPARE-INVALID-AS-OF");
    }
    const now = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ACTIVATION-PREPARE-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    const profiles = getEnforcementProfiles(state);
    const profile = options.version !== undefined ? findEnforcementProfile(options.profileId, options.version, profiles) : findLatestEnforcementProfileVersion(options.profileId, profiles);
    if (!profile) {
      return failure(`No enforcement profile "${options.profileId}"${options.version !== undefined ? ` v${options.version}` : ""} exists.`, ExitCode.InvalidInput, "ACTIVATION-PREPARE-UNKNOWN-PROFILE");
    }
    if (!profile.gates.checkpoint) {
      return failure("The enforcement profile has no checkpoint gate configured; activation preparation requires at least a checkpoint gate.", ExitCode.InvalidInput, "ACTIVATION-PREPARE-NO-CHECKPOINT-GATE");
    }

    const policies = getEvidenceGatePolicies(state);
    const policy = findPolicy(profile.gates.checkpoint.policyRef.policyId, profile.gates.checkpoint.policyRef.version, policies);
    if (!policy || policy.policyDigest !== profile.gates.checkpoint.policyRef.digest) {
      return failure("The profile's referenced policy could not be found or its digest does not match.", ExitCode.InvalidInput, "ACTIVATION-PREPARE-POLICY-MISMATCH");
    }

    const grandfatheredWorkUnitIds = state.workGraph.workUnits.filter((wu) => wu.status === "done").map((wu) => wu.id).sort();

    const evaluation = evaluateGateKConditions({
      state,
      runlogFile: paths.runlogFile,
      profile,
      policy,
      humanInputs: null,
      now,
    });

    const activationSnapshotDigest = computeActivationSnapshotDigest({
      state,
      profileId: profile.profileId,
      profileVersion: profile.version,
      profileDigest: profile.profileDigest,
      policyId: policy.policyId,
      policyVersion: policy.version,
      policyDigest: policy.policyDigest,
      grandfatheredWorkUnitIds,
    });

    const existingPlans = getActivationPlans(state);
    const planId = nextId("RMAP", existingPlans.map((p) => p.planId));
    const expiresAt = new Date(new Date(now).getTime() + ACTIVATION_PLAN_EXPIRY_SECONDS * 1000).toISOString();

    const plan: RequiredModeActivationPlan = {
      protocolVersion: "aiqt-required-mode-activation-plan@1",
      planId,
      profileRef: { profileId: profile.profileId, version: profile.version },
      generatedAt: now,
      expiresAt,
      activationSnapshotDigest,
      grandfatheredWorkUnitIds,
      metrics: evaluation.metrics,
      blockers: evaluation.blockers,
      projectActivationResidualRisk: evaluation.projectActivationResidualRisk,
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: activation plan for ${profile.profileId} v${profile.version} would report risk ${plan.projectActivationResidualRisk}/100 (${plan.blockers.length} blocker(s)); no state written.`,
        exitCode: ExitCode.Success,
        data: { plan, outcome: "preview" },
      });
    }

    const prunedPlans = [...existingPlans, plan].slice(-MAX_ACTIVATION_PLANS);
    const finalState: StateModel = { ...state, requiredModeActivationPlans: prunedPlans };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildActivationPlanPreparedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [planId, project.project.id],
          data: { planId, profileId: profile.profileId, profileVersion: profile.version, projectActivationResidualRisk: plan.projectActivationResidualRisk, blockerCount: plan.blockers.length },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this preparation is idempotent.`,
        ExitCode.InvalidInput,
        "ACTIVATION-PREPARE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Prepared activation plan ${planId} for ${profile.profileId} v${profile.version}: risk ${plan.projectActivationResidualRisk}/100 (${plan.blockers.length} blocker(s)). Preparing a plan never activates enforcement.`,
      completedActions: ["Evaluated Gate K conditions", "Computed activation snapshot digest", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [planId],
      exitCode: ExitCode.Success,
      data: { plan, outcome: "prepared" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "ACTIVATION-PREPARE-UNEXPECTED-ERROR");
  }
}
