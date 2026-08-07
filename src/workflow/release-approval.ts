import type { ReleaseApprovalEvidence, ReleaseRiskAssessment } from "../schema/release-governance.schema.js";

/**
 * M40-WU02 (build spec Sec 5.5, 5.7): the required approval authority is
 * always derived from the risk assessment, never supplied directly by a
 * caller. Human approval/waiver facts (who approved, when, the waiver
 * itself) stay null until an authorized actor supplies them explicitly --
 * this function never fabricates that evidence (build spec Sec 5.3, 5.7).
 */
export function buildInitialApprovalEvidence(risk: ReleaseRiskAssessment): ReleaseApprovalEvidence {
  return {
    authority: risk.requiredApprovalAuthority,
    humanApprovedBy: null,
    humanApprovedAt: null,
    waiver: null,
  };
}
