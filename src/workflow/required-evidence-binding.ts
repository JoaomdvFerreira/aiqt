import type { EvidenceRecord } from "../schema/evidence.schema.js";

/** Loosened locally: the checkpoint gate's workUnit is always "required", but the review gate's is optional -- both shapes satisfy this. */
export interface BindingRequirementsLike {
  workUnit?: "optional" | "required";
  packet?: "optional" | "required";
  implementationRoot?: "optional" | "required";
  codeState?: "optional" | "required";
}

/**
 * M30 §4.2/§6: "Provider acceptance does not imply trust" -- reads only
 * the canonical M22 provider.providerId field; never an executable
 * adapter, never a trust judgment.
 */
export function isProviderAccepted(evidence: EvidenceRecord, acceptedProviders?: readonly string[]): boolean {
  if (!acceptedProviders || acceptedProviders.length === 0) return true;
  return acceptedProviders.includes(evidence.provider.providerId);
}

export interface BindingContext {
  workUnitId: string;
  packetId?: string;
  implementationRootId?: string;
}

/**
 * M30 §4.2: bounded presence/equality checks against the canonical M22
 * workflowBinding/codeBinding fields only -- no Git execution, no network
 * call, no workspace inspection. "codeState: required" is satisfied by the
 * presence of at least one of commitSha/workingTreeFingerprint/
 * repositoryFingerprint already recorded on the evidence at import time.
 */
export function meetsBindingRequirements(evidence: EvidenceRecord, requirements: BindingRequirementsLike, context: BindingContext): boolean {
  if (requirements.workUnit === "required" && evidence.workflowBinding.workUnitId !== context.workUnitId) return false;

  if (requirements.packet === "required") {
    if (!evidence.workflowBinding.packetId) return false;
    if (context.packetId && evidence.workflowBinding.packetId !== context.packetId) return false;
  }

  if (requirements.implementationRoot === "required") {
    if (!evidence.workflowBinding.implementationRootId) return false;
    if (context.implementationRootId && evidence.workflowBinding.implementationRootId !== context.implementationRootId) return false;
  }

  if (requirements.codeState === "required") {
    const { commitSha, workingTreeFingerprint, repositoryFingerprint } = evidence.codeBinding;
    if (!commitSha && !workingTreeFingerprint && !repositoryFingerprint) return false;
  }

  return true;
}
