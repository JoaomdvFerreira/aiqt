import { z } from "zod";

/**
 * M40-WU01: single release-governance contract owner (build spec Sec 6).
 * Reuses existing owners rather than duplicating them -- evidence trust
 * concepts mirror src/schema/evidence.schema.ts's TrustLevel model, digests
 * reuse src/schema/external-evidence/canonical-json.ts, and Git/version
 * facts are read through src/workspaces/git-command-runner.ts and
 * src/tooling/semver.ts. This file defines data shapes only: no network, no
 * external process invocation, no GitHub access.
 */

// ---------------------------------------------------------------------------
// Evidence honesty (build spec Sec 5.3).
// ---------------------------------------------------------------------------

export const ReleaseEvidenceStatusSchema = z.enum([
  "verified",
  "reconstructed",
  "partial",
  "missing",
  "waived",
]);
export type ReleaseEvidenceStatus = z.infer<typeof ReleaseEvidenceStatusSchema>;

export const ReleaseEvidenceItemSchema = z.object({
  key: z.string().min(1),
  status: ReleaseEvidenceStatusSchema,
  description: z.string().min(1),
  locator: z.string().nullable(),
  digest: z.string().nullable(),
});
export type ReleaseEvidenceItem = z.infer<typeof ReleaseEvidenceItemSchema>;

export const ReleaseEvidenceSchema = z.object({
  items: z.array(ReleaseEvidenceItemSchema),
});
export type ReleaseEvidence = z.infer<typeof ReleaseEvidenceSchema>;

// ---------------------------------------------------------------------------
// Candidate identity and milestone references (build spec Sec 5.1, 6).
// ---------------------------------------------------------------------------

export const ReleaseMilestoneRefSchema = z.object({
  milestoneId: z.string().min(1),
  title: z.string().nullable(),
  /** Milestone completion status as read from live project state, when available. */
  status: z.string().nullable(),
  /** Operator-declared milestone tag (e.g. "m39-agent-execution-efficiency"). */
  tag: z.string().nullable(),
  /** Git-resolved commit the declared tag actually points to, when verifiable. */
  tagCommit: z.string().nullable(),
  /** Operator-declared closure commit for this milestone. */
  closureCommit: z.string().nullable(),
  evidenceStatus: ReleaseEvidenceStatusSchema,
});
export type ReleaseMilestoneRef = z.infer<typeof ReleaseMilestoneRefSchema>;

export const ReleaseIdentitySchema = z.object({
  repositoryIdentity: z.string().min(1),
  packageVersion: z.string().min(1),
  /** Canonical schema version, only when the candidate repository has one (build spec Sec 5.4). */
  schemaVersion: z.string().nullable(),
  intendedReleaseTag: z.string().min(1),
  candidateCommit: z.string().min(1),
  baseRelease: z.string().nullable(),
});
export type ReleaseIdentity = z.infer<typeof ReleaseIdentitySchema>;

export const ReleaseCandidateSchema = z.object({
  candidateId: z.string().min(1),
  identity: ReleaseIdentitySchema,
  milestones: z.array(ReleaseMilestoneRefSchema).min(1),
  evidence: ReleaseEvidenceSchema,
  createdAt: z.string(),
});
export type ReleaseCandidate = z.infer<typeof ReleaseCandidateSchema>;

// ---------------------------------------------------------------------------
// Provenance binding (build spec Sec 6.1) -- deterministic digest.
// ---------------------------------------------------------------------------

export const ReleaseProvenanceSchema = z.object({
  candidateCommit: z.string().min(1),
  ciCommit: z.string().nullable(),
  ciRunIdentity: z.string().nullable(),
  ciStatus: ReleaseEvidenceStatusSchema,
  packageVersion: z.string().min(1),
  schemaVersion: z.string().nullable(),
  intendedReleaseTag: z.string().min(1),
  baseRelease: z.string().nullable(),
  includedMilestoneIds: z.array(z.string()),
  includedMilestoneTags: z.array(z.string().nullable()),
  includedMilestoneClosureCommits: z.array(z.string().nullable()),
  closureReportDigests: z.array(z.string().nullable()),
  validationEvidenceDigest: z.string().nullable(),
  securityEvidenceStatus: ReleaseEvidenceStatusSchema,
  releaseNotesDigest: z.string().nullable(),
  riskAssessmentVersion: z.string().nullable(),
  approvalAuthorityDecision: z.string().nullable(),
  /** sha256 hex digest, deterministic for identical canonical inputs (all fields above except this one). */
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type ReleaseProvenance = z.infer<typeof ReleaseProvenanceSchema>;

// ---------------------------------------------------------------------------
// Readiness (build spec Sec 5.7, 8).
// ---------------------------------------------------------------------------

export const ReleaseCandidateIntegritySchema = z.enum([
  "ready",
  "ready_with_warnings",
  "blocked",
  "insufficient_evidence",
]);
export type ReleaseCandidateIntegrity = z.infer<typeof ReleaseCandidateIntegritySchema>;

export const ReleaseBlockingFindingSchema = z.object({
  id: z.string().min(1),
  area: z.string().min(1),
  message: z.string().min(1),
  evidenceKey: z.string().nullable(),
});
export type ReleaseBlockingFinding = z.infer<typeof ReleaseBlockingFindingSchema>;

export const ReleaseWarningSchema = z.object({
  id: z.string().min(1),
  area: z.string().min(1),
  message: z.string().min(1),
  evidenceKey: z.string().nullable(),
});
export type ReleaseWarning = z.infer<typeof ReleaseWarningSchema>;

export const ReleaseReadinessAssessmentSchema = z.object({
  integrity: ReleaseCandidateIntegritySchema,
  blockingFindings: z.array(ReleaseBlockingFindingSchema),
  warnings: z.array(ReleaseWarningSchema),
  /** Optional artifacts explicitly not applicable to this candidate, distinct from "missing" (build spec Sec 8). */
  notApplicable: z.array(z.string()),
  evaluatedAt: z.string(),
});
export type ReleaseReadinessAssessment = z.infer<typeof ReleaseReadinessAssessmentSchema>;

// ---------------------------------------------------------------------------
// Risk scoring and approval authority (build spec Sec 5.5, 7) -- shapes only
// here; WU40-02 owns the scoring function that produces these values.
// ---------------------------------------------------------------------------

export const ReleaseRiskStatusSchema = z.enum(["green", "yellow", "orange", "red"]);
export type ReleaseRiskStatus = z.infer<typeof ReleaseRiskStatusSchema>;

export const ReleaseApprovalAuthoritySchema = z.enum([
  "agent_approval_permitted",
  "human_approval_required",
  "human_waiver_required",
]);
export type ReleaseApprovalAuthority = z.infer<typeof ReleaseApprovalAuthoritySchema>;

export const ReleaseRiskCategoryIdSchema = z.enum([
  "security_supply_chain",
  "regression_exposure",
  "architectural_blast_radius",
  "test_confidence",
  "operational_complexity",
  "compatibility_migration",
  "rollback_recovery",
  "pilot_dogfood_maturity",
  "known_limitations",
]);
export type ReleaseRiskCategoryId = z.infer<typeof ReleaseRiskCategoryIdSchema>;

export const ReleaseRiskCategoryScoreSchema = z.object({
  category: ReleaseRiskCategoryIdSchema,
  score: z.number().int().min(0),
  max: z.number().int().min(0),
  rationale: z.string().min(1),
});
export type ReleaseRiskCategoryScore = z.infer<typeof ReleaseRiskCategoryScoreSchema>;

export const ReleaseRiskAssessmentSchema = z.object({
  totalScore: z.number().int().min(0).max(100),
  status: ReleaseRiskStatusSchema,
  categories: z.array(ReleaseRiskCategoryScoreSchema),
  majorContributors: z.array(z.string()),
  mitigations: z.array(z.string()),
  residualRisks: z.array(z.string()),
  blockers: z.array(z.string()),
  operationalRecommendation: z.string(),
  requiredApprovalAuthority: ReleaseApprovalAuthoritySchema,
  waiverRequired: z.boolean(),
  assessmentVersion: z.string().min(1),
  evidenceGaps: z.array(z.string()),
});
export type ReleaseRiskAssessment = z.infer<typeof ReleaseRiskAssessmentSchema>;

// ---------------------------------------------------------------------------
// Publication authority (build spec Sec 5.6, 5.7) -- never fabricated;
// human/waiver fields stay null until an actor supplies them explicitly.
// ---------------------------------------------------------------------------

export const ReleaseWaiverSchema = z.object({
  waiverId: z.string().min(1),
  grantedBy: z.string().min(1),
  reason: z.string().min(1),
  grantedAt: z.string(),
});
export type ReleaseWaiver = z.infer<typeof ReleaseWaiverSchema>;

export const ReleaseApprovalEvidenceSchema = z.object({
  authority: ReleaseApprovalAuthoritySchema,
  humanApprovedBy: z.string().nullable(),
  humanApprovedAt: z.string().nullable(),
  waiver: ReleaseWaiverSchema.nullable(),
});
export type ReleaseApprovalEvidence = z.infer<typeof ReleaseApprovalEvidenceSchema>;

// ---------------------------------------------------------------------------
// GitHub draft state (build spec Sec 11) -- shape only; WU40-04 owns the
// real side effect. WU40-01 through WU40-03 only ever produce "not_created".
// ---------------------------------------------------------------------------

export const ReleaseDraftStatusSchema = z.enum(["not_created", "created", "exists"]);
export type ReleaseDraftStatus = z.infer<typeof ReleaseDraftStatusSchema>;

export const ReleaseDraftStateSchema = z.object({
  status: ReleaseDraftStatusSchema,
  url: z.string().nullable(),
  id: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type ReleaseDraftState = z.infer<typeof ReleaseDraftStateSchema>;

export const NOT_CREATED_DRAFT_STATE: ReleaseDraftState = {
  status: "not_created",
  url: null,
  id: null,
  createdAt: null,
};

// ---------------------------------------------------------------------------
// Top-level decision envelope.
// ---------------------------------------------------------------------------

export const ReleaseDecisionSchema = z.object({
  candidate: ReleaseCandidateSchema,
  provenance: ReleaseProvenanceSchema,
  readiness: ReleaseReadinessAssessmentSchema,
  risk: ReleaseRiskAssessmentSchema.nullable(),
  approval: ReleaseApprovalEvidenceSchema.nullable(),
  draft: ReleaseDraftStateSchema,
});
export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;
