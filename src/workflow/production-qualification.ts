import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";
import { latestCheckpointForWorkUnit } from "../services/checkpoint-amendment-service.js";
import { computeEffectiveReviewState } from "../services/effective-review-state-service.js";

/**
 * M49-WU4's deliberately small, derived production contract.  These values
 * are not persisted: a qualification is only meaningful for the revision and
 * facts supplied to this evaluator.
 */
export type RequirementOutcome = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
export type QualificationStatus = "QUALIFIED" | "BLOCKED" | "UNKNOWN";
export type ProductionVerificationStatus = "VERIFIED" | "FAILED" | "UNKNOWN" | "NOT_APPLICABLE";

export interface QualificationAuthorityDecision {
  decisionId: string;
  /** The requirement IDs this decision may permit, never a blanket override. */
  requirementIds: readonly string[];
  permitsProgress: boolean;
  authority: string;
  reason: string;
}

export interface QualificationRequirement {
  requirementId: string;
  title: string;
  outcome: RequirementOutcome;
  /** A failed or unknown requirement may be permitted only by an exact decision. */
  authorityRequired?: boolean;
  evidenceIds?: readonly string[];
  reason?: string;
  reasonCode?: QualificationReason["code"];
}

export interface QualificationReason {
  code:
    | "failed_requirement"
    | "missing_evidence"
    | "stale_evidence"
    | "revision_mismatch"
    | "unresolved_blocker"
    | "missing_authority"
    | "accepted_exception"
    | "unknown_external_fact"
    | "revision_required";
  requirementId?: string;
  message: string;
  authorityDecisionId?: string;
}

export interface RequirementAssessment extends QualificationRequirement {
  authorityDecision: QualificationAuthorityDecision | null;
  progressionPermitted: boolean;
}

export interface ChangeQualification {
  kind: "change_qualification";
  workUnitId: string;
  revision: string | null;
  status: QualificationStatus;
  requirements: RequirementAssessment[];
  reasons: QualificationReason[];
}

export interface ProjectProductionReadiness {
  kind: "project_production_readiness";
  revision: string | null;
  status: QualificationStatus;
  workQualifications: ChangeQualification[];
  baselineRequirements: RequirementAssessment[];
  productionVerification: ProductionVerificationStatus;
  reasons: QualificationReason[];
}

function applicableDecision(
  requirement: QualificationRequirement,
  decisions: readonly QualificationAuthorityDecision[],
): QualificationAuthorityDecision | null {
  return decisions.find((decision) => decision.permitsProgress && decision.requirementIds.includes(requirement.requirementId)) ?? null;
}

/**
 * Pure, deterministic rule: authority can permit progression, but it never
 * changes the requirement outcome.  A consumer can therefore see both the
 * technical FAIL/UNKNOWN and the separate human decision.
 */
export function deriveChangeQualification(input: {
  workUnitId: string;
  revision: string | null;
  requirements: readonly QualificationRequirement[];
  decisions?: readonly QualificationAuthorityDecision[];
}): ChangeQualification {
  const decisions = input.decisions ?? [];
  const reasons: QualificationReason[] = [];
  const requirements = input.requirements.map((requirement): RequirementAssessment => {
    const authorityDecision = applicableDecision(requirement, decisions);
    const progressionPermitted = requirement.outcome === "PASS" || requirement.outcome === "NOT_APPLICABLE" || authorityDecision !== null;
    if (authorityDecision) {
      reasons.push({
        code: "accepted_exception",
        requirementId: requirement.requirementId,
        authorityDecisionId: authorityDecision.decisionId,
        message: `Requirement "${requirement.requirementId}" remains ${requirement.outcome}; progression is permitted by ${authorityDecision.authority}.`,
      });
    }
    if (requirement.outcome === "FAIL") {
      reasons.push({ code: "failed_requirement", requirementId: requirement.requirementId, message: requirement.reason ?? `Requirement "${requirement.requirementId}" failed.` });
    } else if (requirement.outcome === "UNKNOWN") {
      reasons.push({ code: requirement.reasonCode ?? "unknown_external_fact", requirementId: requirement.requirementId, message: requirement.reason ?? `Requirement "${requirement.requirementId}" is unknown.` });
    }
    if (requirement.authorityRequired && authorityDecision === null) {
      reasons.push({ code: "missing_authority", requirementId: requirement.requirementId, message: `Requirement "${requirement.requirementId}" requires an applicable authority decision.` });
    }
    return { ...requirement, authorityDecision, progressionPermitted };
  });

  if (input.revision === null) {
    reasons.unshift({ code: "revision_required", message: "No exact revision was supplied; qualification cannot be claimed." });
  }

  const hasUnpermittedFailure = requirements.some((requirement) => requirement.outcome === "FAIL" && !requirement.progressionPermitted);
  const hasUnpermittedUnknown = requirements.some((requirement) => requirement.outcome === "UNKNOWN" && !requirement.progressionPermitted);
  const hasMissingAuthority = requirements.some((requirement) => requirement.authorityRequired && requirement.authorityDecision === null);
  const status: QualificationStatus = input.revision === null || hasUnpermittedUnknown
    ? "UNKNOWN"
    : hasUnpermittedFailure || hasMissingAuthority
      ? "BLOCKED"
      : requirements.length === 0
        ? "UNKNOWN"
        : "QUALIFIED";
  return { kind: "change_qualification", workUnitId: input.workUnitId, revision: input.revision, status, requirements, reasons };
}

function checkpointOutcome(value: "passed" | "failed" | "partial" | "not_run" | "not_checked"): RequirementOutcome {
  return value === "passed" ? "PASS" : value === "failed" ? "FAIL" : "UNKNOWN";
}

/** Builds only facts that AIQT already owns.  It intentionally does not infer
 * deployment, runtime, CI, or security facts from a completed work unit. */
export function deriveWorkQualification(params: {
  project: ProjectModel;
  state: StateModel;
  workUnitId: string;
  revision: string | null;
  reviewFindings?: readonly ReviewFinding[];
}): ChangeQualification {
  const workUnit = params.state.workGraph.workUnits.find((candidate) => candidate.id === params.workUnitId);
  if (!workUnit) {
    return deriveChangeQualification({ workUnitId: params.workUnitId, revision: params.revision, requirements: [{ requirementId: "work-unit-exists", title: "Work unit exists", outcome: "UNKNOWN", reason: "The requested work unit is not present in canonical state." }] });
  }
  const requirements: QualificationRequirement[] = [];
  const checkpoint = latestCheckpointForWorkUnit(params.state, workUnit.id);
  if (!checkpoint) {
    requirements.push({ requirementId: "implementation-evidence", title: "Implementation evidence", outcome: "UNKNOWN", reason: "No checkpoint evidence is available for this work unit." });
  } else {
    const effective = computeEffectiveReviewState(checkpoint, params.state);
    if (params.project.quality.validationRequiredBeforeDone) {
      requirements.push({ requirementId: "validation", title: "Required validation", outcome: checkpointOutcome(effective.validationResult), reason: `Effective validation result is "${effective.validationResult}".` });
    }
    if (params.project.quality.acceptanceCriteriaRequired) {
      requirements.push({ requirementId: "acceptance", title: "Acceptance criteria", outcome: checkpointOutcome(effective.acceptanceCriteriaResult), reason: `Effective acceptance result is "${effective.acceptanceCriteriaResult}".` });
    }
    if (effective.issues.some((issue) => issue.status === "open" && (issue.severity === "high" || issue.severity === "critical"))) {
      requirements.push({ requirementId: "unresolved-blockers", title: "No unresolved blocking issues", outcome: "FAIL", reason: "The checkpoint has unresolved high or critical issues." });
    }
  }
  if (workUnit.status !== "done") {
    requirements.push({ requirementId: "implementation-complete", title: "Implementation complete", outcome: "FAIL", reason: `Work unit lifecycle status is "${workUnit.status}", not "done".` });
  }
  if ((params.reviewFindings ?? []).some((finding) => finding.blocking && finding.relatedIds.includes(workUnit.id))) {
    requirements.push({ requirementId: "review-blockers", title: "No unresolved review blockers", outcome: "FAIL", reason: "A blocking review finding applies to this work unit." });
  }
  const evidence = (params.state.evidence?.records ?? []).filter((record) => record.workflowBinding.workUnitId === workUnit.id);
  const revisionBoundEvidence = evidence.filter((record) => record.codeBinding.commitSha === params.revision);
  const trustedRevisionEvidence = revisionBoundEvidence.filter(
    (record) => record.observedAt !== undefined && (record.provider.trustLevel === "repository_local" || record.provider.trustLevel === "platform_verified"),
  );
  if (evidence.length === 0) {
    requirements.push({ requirementId: "revision-bound-evidence", title: "Revision-bound evidence", outcome: "UNKNOWN", reasonCode: "missing_evidence", reason: "No evidence is bound to this work unit and exact revision." });
  } else if (revisionBoundEvidence.length === 0) {
    requirements.push({ requirementId: "revision-bound-evidence", title: "Revision-bound evidence", outcome: "UNKNOWN", reasonCode: "revision_mismatch", reason: "Available evidence is not bound to the exact revision under assessment." });
  } else if (trustedRevisionEvidence.length === 0) {
    requirements.push({ requirementId: "revision-bound-evidence", title: "Revision-bound evidence", outcome: "UNKNOWN", reasonCode: "stale_evidence", reason: "Revision-bound evidence lacks a trustworthy observation time or trusted provenance." });
  } else if (trustedRevisionEvidence.some((record) => record.results.validationResult === "failed" || record.results.acceptanceCriteriaResult === "failed" || record.results.reviewResult === "failed")) {
    requirements.push({ requirementId: "revision-bound-evidence", title: "Revision-bound evidence", outcome: "FAIL", reason: "Trusted evidence bound to this revision records a failed result." });
  } else if (trustedRevisionEvidence.some((record) => record.results.validationResult === "passed" || record.results.acceptanceCriteriaResult === "passed" || record.results.reviewResult === "passed")) {
    requirements.push({ requirementId: "revision-bound-evidence", title: "Revision-bound evidence", outcome: "PASS", evidenceIds: trustedRevisionEvidence.map((record) => record.evidenceId) });
  } else {
    requirements.push({ requirementId: "revision-bound-evidence", title: "Revision-bound evidence", outcome: "UNKNOWN", reason: "Trusted evidence bound to this revision has no successful verification outcome." });
  }
  // A historical done record with no relevant checkpoint is deliberately
  // UNKNOWN above; done is implementation completion, never qualification.
  return deriveChangeQualification({ workUnitId: workUnit.id, revision: params.revision, requirements });
}

export function deriveProductionVerification(input: { applicable: boolean; outcomes: readonly RequirementOutcome[] }): ProductionVerificationStatus {
  if (!input.applicable) return "NOT_APPLICABLE";
  if (input.outcomes.some((outcome) => outcome === "FAIL")) return "FAILED";
  if (input.outcomes.length === 0 || input.outcomes.some((outcome) => outcome === "UNKNOWN")) return "UNKNOWN";
  return "VERIFIED";
}

/** Minimal project view: aggregate the per-work canonical facts and preserve
 * unknown production/runtime facts rather than inventing a standards policy. */
export function deriveProjectProductionReadiness(params: {
  project: ProjectModel;
  state: StateModel;
  revision: string | null;
  reviewFindings?: readonly ReviewFinding[];
  productionVerification?: { applicable: boolean; outcomes: readonly RequirementOutcome[] };
}): ProjectProductionReadiness {
  const workQualifications = params.state.workGraph.workUnits.map((workUnit) => deriveWorkQualification({ ...params, workUnitId: workUnit.id }));
  const baselineRequirements = workQualifications.flatMap((qualification) => qualification.requirements);
  const productionVerification = deriveProductionVerification(params.productionVerification ?? { applicable: true, outcomes: [] });
  const reasons = workQualifications.flatMap((qualification) => qualification.reasons);
  if (productionVerification === "UNKNOWN") reasons.push({ code: "unknown_external_fact", message: "Production verification is unknown: AIQT has no applicable deployment/runtime observation." });
  const status: QualificationStatus = params.revision === null || productionVerification === "UNKNOWN" || workQualifications.some((qualification) => qualification.status === "UNKNOWN")
    ? "UNKNOWN"
    : workQualifications.some((qualification) => qualification.status === "BLOCKED") || productionVerification === "FAILED"
      ? "BLOCKED"
      : workQualifications.length === 0
        ? "UNKNOWN"
        : "QUALIFIED";
  return { kind: "project_production_readiness", revision: params.revision, status, workQualifications, baselineRequirements, productionVerification, reasons };
}
