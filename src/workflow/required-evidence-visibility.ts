import type { StateModel } from "../schema/state.schema.js";
import { resolveEffectiveEvidenceMode, getActiveActivation, getActivationPlans, getRequiredEvidenceExceptions } from "../services/evidence-enforcement-service.js";
import { getProjectIssues, resolveEffectiveProjectIssueLifecycle } from "../services/project-issue-service.js";
import { getIssueOverrides, getIssuePromotions } from "../services/issue-service.js";
import { isRequiredIssueKey } from "./required-evidence-issues.js";
import { recoveryCommandsFor } from "./checkpoint-required-evidence-integration.js";

export interface RequiredEvidenceVisibilitySummary {
  effectiveMode: "off" | "advisory" | "required";
  activation: { activationId: string; profileId: string; profileVersion: number } | null;
  profile: { profileId: string; version: number } | null;
  grandfatheredWorkUnits: number;
  activeExceptions: number;
  blockedTargets: number;
  needsReviewTargets: number;
  currentRecoveryCommand: string | null;
  projectActivationResidualRisk: number | null;
  blocking: false;
}

/**
 * M30 §10.3: "Use one centralized required-evidence projection." Status,
 * manage, and export all render this same bounded shape. `blockedTargets`
 * is always 0 by construction -- a genuinely blocked attempt performs zero
 * canonical mutation (§7.4), so there is never a persisted "blocked"
 * required-evidence record to count; only needs_review-class deficiencies
 * (which DO persist, as a downgraded checkpoint plus a required
 * ProjectIssue) are counted here.
 */
export function buildRequiredEvidenceVisibilitySummary(state: StateModel): RequiredEvidenceVisibilitySummary {
  const effectiveMode = resolveEffectiveEvidenceMode(state);
  const activation = getActiveActivation(state);
  const overrides = getIssueOverrides(state);
  const promotions = getIssuePromotions(state);

  const openRequiredIssues = getProjectIssues(state).filter(
    (issue) => isRequiredIssueKey(issue.issueKey) && resolveEffectiveProjectIssueLifecycle(issue.issueKey, overrides, promotions) === "active",
  );

  const plans = getActivationPlans(state);
  const latestPlan = plans.length > 0 ? plans[plans.length - 1] : null;

  const firstDeficiencyRule = openRequiredIssues[0];
  const currentRecoveryCommand = firstDeficiencyRule ? (recoveryCommandsFor("failed")[0] ?? null) : null;

  return {
    effectiveMode,
    activation: activation ? { activationId: activation.activationId, profileId: activation.profileRef.profileId, profileVersion: activation.profileRef.version } : null,
    profile: activation ? { profileId: activation.profileRef.profileId, version: activation.profileRef.version } : null,
    grandfatheredWorkUnits: activation?.grandfatheredWorkUnitIds.length ?? 0,
    activeExceptions: getRequiredEvidenceExceptions(state).filter((e) => e.status === "active").length,
    blockedTargets: 0,
    needsReviewTargets: openRequiredIssues.length,
    currentRecoveryCommand,
    projectActivationResidualRisk: activation ? null : (latestPlan?.projectActivationResidualRisk ?? null),
    blocking: false,
  };
}
