import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getActiveActivation, getActivationPlans, resolveEffectiveEvidenceMode } from "../../services/evidence-enforcement-service.js";

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

/** aiqt evidence gate enforcement status [--json] (M30 §5.3): read-only, derives effective mode -- never simulates or mutates. */
export function runEvidenceGateEnforcementStatus(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ENFORCEMENT-STATUS-NO-PROJECT");
  }
  const { state } = loadProject(ctx);

  const effectiveMode = resolveEffectiveEvidenceMode(state);
  const activeActivation = getActiveActivation(state);
  const plans = getActivationPlans(state);
  const latestPlan = plans.length > 0 ? plans[plans.length - 1] : null;

  return makeResult({
    status: "passed",
    action: "evidence",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `Effective evidence mode: ${effectiveMode}.${activeActivation ? ` Active activation: ${activeActivation.activationId} (profile ${activeActivation.profileRef.profileId} v${activeActivation.profileRef.version}).` : ""}`,
    exitCode: ExitCode.Success,
    data: {
      effectiveMode,
      activation: activeActivation
        ? { activationId: activeActivation.activationId, profileId: activeActivation.profileRef.profileId, profileVersion: activeActivation.profileRef.version, activatedAt: activeActivation.activatedAt, grandfatheredWorkUnitCount: activeActivation.grandfatheredWorkUnitIds.length }
        : null,
      latestPlan: latestPlan
        ? { planId: latestPlan.planId, profileId: latestPlan.profileRef.profileId, profileVersion: latestPlan.profileRef.version, projectActivationResidualRisk: latestPlan.projectActivationResidualRisk, blockers: latestPlan.blockers, expiresAt: latestPlan.expiresAt }
        : null,
    },
  });
}
