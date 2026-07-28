import type { StateModel } from "../schema/state.schema.js";
import type { EvidenceEnforcementProfile } from "../schema/evidence-enforcement-profile.schema.js";
import type { RequiredModeActivation } from "../schema/required-mode-activation.schema.js";
import type { RequiredModeActivationPlan } from "../schema/required-mode-activation-plan.schema.js";
import type { RequiredRuleRecoveryProof } from "../schema/required-rule-recovery-proof.schema.js";
import type { RequiredEvidenceException } from "../schema/required-evidence-exception.schema.js";
import { resolveActivePolicy } from "./evidence-gate-policy-service.js";

/** M30 §4.1: additive/optional state collection, empty by default on pre-M30 state -- mirrors getEvidenceGatePolicies exactly. */
export function getEnforcementProfiles(state: StateModel): EvidenceEnforcementProfile[] {
  return state.enforcementProfiles ?? [];
}

export function findEnforcementProfileVersions(profileId: string, profiles: readonly EvidenceEnforcementProfile[]): EvidenceEnforcementProfile[] {
  return profiles.filter((p) => p.profileId === profileId);
}

export function findEnforcementProfile(profileId: string, version: number, profiles: readonly EvidenceEnforcementProfile[]): EvidenceEnforcementProfile | undefined {
  return profiles.find((p) => p.profileId === profileId && p.version === version);
}

export function findLatestEnforcementProfileVersion(profileId: string, profiles: readonly EvidenceEnforcementProfile[]): EvidenceEnforcementProfile | undefined {
  const versions = findEnforcementProfileVersions(profileId, profiles);
  if (versions.length === 0) return undefined;
  return versions.reduce((latest, p) => (p.version > latest.version ? p : latest));
}

export function maxEnforcementProfileVersion(profileId: string, profiles: readonly EvidenceEnforcementProfile[]): number {
  return findEnforcementProfileVersions(profileId, profiles).reduce((max, p) => Math.max(max, p.version), 0);
}

export function getRequiredModeActivations(state: StateModel): RequiredModeActivation[] {
  return state.requiredModeActivations ?? [];
}

/** M30 §4.7: at most one activation is ever "active" at a time (enforced by the activate command). */
export function getActiveActivation(state: StateModel): RequiredModeActivation | undefined {
  return getRequiredModeActivations(state).find((a) => a.status === "active");
}

export function getActivationPlans(state: StateModel): RequiredModeActivationPlan[] {
  return state.requiredModeActivationPlans ?? [];
}

export function findActivationPlan(planId: string, state: StateModel): RequiredModeActivationPlan | undefined {
  return getActivationPlans(state).find((p) => p.planId === planId);
}

export function getRecoveryProofs(state: StateModel): RequiredRuleRecoveryProof[] {
  return state.requiredRuleRecoveryProofs ?? [];
}

export function getRequiredEvidenceExceptions(state: StateModel): RequiredEvidenceException[] {
  return state.requiredEvidenceExceptions ?? [];
}

export type EffectiveEvidenceMode = "off" | "advisory" | "required";

/**
 * M30 §2: "no historical project receives a new persisted default." The
 * effective mode is derived, never stored: required only with a currently
 * active (status "active") activation; advisory only when no active
 * required activation exists AND an M28 active policy is selected;
 * otherwise off. Importing a profile or preparing a plan never changes
 * this -- only an explicit `activation activate` mutation does.
 */
export function resolveEffectiveEvidenceMode(state: StateModel): EffectiveEvidenceMode {
  if (getActiveActivation(state)) return "required";
  if (resolveActivePolicy(state)) return "advisory";
  return "off";
}
