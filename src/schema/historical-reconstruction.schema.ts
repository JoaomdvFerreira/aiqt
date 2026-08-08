import { z } from "zod";
import { ReleaseEvidenceStatusSchema } from "./release-governance.schema.js";

/**
 * M44-WU01: historical release reconstruction contract (build spec Sec 6).
 * A HistoricalReleaseTarget/ReconstructionAssessment is never a
 * ReleaseCandidate/ReleaseDecision -- it is transient input that, when
 * sufficiently evidenced, is mapped into the existing M40
 * release-governance schema (src/schema/release-governance.schema.ts)
 * rather than duplicating it. Reuses M40's ReleaseEvidenceStatus vocabulary
 * unchanged (verified/reconstructed/partial/missing/waived) and adds only
 * the "conflicting" finding kind M40 does not already have, expressed as a
 * blocking finding rather than a sixth evidence-item status (build spec
 * Sec 6.3, Sec 9 point 9).
 */

// ---------------------------------------------------------------------------
// Evidence-source provenance (build spec Sec 7).
// ---------------------------------------------------------------------------

export const HistoricalEvidenceSourceKindSchema = z.enum([
  "git_tag",
  "git_ancestry",
  "package_manifest_at_commit",
  "schema_version_at_commit",
  "milestone_closure_report",
  "milestone_tag",
  "github_release_lookup",
  "github_draft_lookup",
  "github_ci_lookup",
]);
export type HistoricalEvidenceSourceKind = z.infer<typeof HistoricalEvidenceSourceKindSchema>;

export const HistoricalEvidenceItemSchema = z.object({
  key: z.string().min(1),
  sourceKind: HistoricalEvidenceSourceKindSchema,
  status: ReleaseEvidenceStatusSchema,
  description: z.string().min(1),
  locator: z.string().nullable(),
  digest: z.string().nullable(),
});
export type HistoricalEvidenceItem = z.infer<typeof HistoricalEvidenceItemSchema>;

/**
 * A disagreement between two evidence items (build spec Sec 6.3, Sec 7.3).
 * Conflicts remain visible even after a stronger source wins identity
 * resolution -- this is never collapsed into a single evidence-item status.
 */
export const HistoricalEvidenceConflictSchema = z.object({
  id: z.string().min(1),
  message: z.string().min(1),
  evidenceKeys: z.array(z.string().min(1)).min(2),
});
export type HistoricalEvidenceConflict = z.infer<typeof HistoricalEvidenceConflictSchema>;

// ---------------------------------------------------------------------------
// HistoricalReleaseTarget (build spec Sec 6.2).
// ---------------------------------------------------------------------------

export const HistoricalMilestoneRefSchema = z.object({
  milestoneId: z.string().min(1),
  tag: z.string().nullable(),
  tagCommit: z.string().nullable(),
  closureReportPath: z.string().nullable(),
  closureCommit: z.string().nullable(),
  evidenceStatus: ReleaseEvidenceStatusSchema,
});
export type HistoricalMilestoneRef = z.infer<typeof HistoricalMilestoneRefSchema>;

export const HistoricalReleaseTargetSchema = z.object({
  repositoryIdentity: z.string().min(1),
  requestedTag: z.string().min(1),
  resolvedCommit: z.string().nullable(),
  packageVersionAtCommit: z.string().nullable(),
  schemaVersionAtCommit: z.string().nullable(),
  /** Nearest unambiguous prior semantic release tag reachable in ancestry, or explicit null on ambiguity (build spec Sec 8). */
  baseRelease: z.string().nullable(),
  baseReleaseAmbiguous: z.boolean(),
  milestones: z.array(HistoricalMilestoneRefSchema),
  /** Git commit timestamp of resolvedCommit, ISO 8601, Git metadata only -- never wall-clock "now". */
  targetCommitTime: z.string().nullable(),
});
export type HistoricalReleaseTarget = z.infer<typeof HistoricalReleaseTargetSchema>;

// ---------------------------------------------------------------------------
// Reconstruction-quality outcome (build spec Sec 6.4).
// ---------------------------------------------------------------------------

export const ReconstructionStatusSchema = z.enum([
  "existing_release",
  "reconstructable",
  "reconstructable_with_warnings",
  "partial",
  "conflicting",
  "insufficient_evidence",
]);
export type ReconstructionStatus = z.infer<typeof ReconstructionStatusSchema>;

export const ReconstructionAssessmentSchema = z.object({
  target: HistoricalReleaseTargetSchema,
  evidence: z.array(HistoricalEvidenceItemSchema),
  conflicts: z.array(HistoricalEvidenceConflictSchema),
  status: ReconstructionStatusSchema,
  /**
   * Deterministic sha256 digest over target identity + evidence + conflicts
   * only (build spec Sec 6.5) -- excludes evaluatedAt and any other
   * volatile presentation field, so identical bounded evidence always
   * yields an identical fingerprint.
   */
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  evaluatedAt: z.string(),
});
export type ReconstructionAssessment = z.infer<typeof ReconstructionAssessmentSchema>;

// ---------------------------------------------------------------------------
// Existing-release/draft boundary (build spec Sec 11).
// ---------------------------------------------------------------------------

export const ExistingReleaseLookupStatusSchema = z.enum(["found", "not_found", "unverified"]);
export type ExistingReleaseLookupStatus = z.infer<typeof ExistingReleaseLookupStatusSchema>;

export const ExistingReleaseStateSchema = z.object({
  releaseStatus: ExistingReleaseLookupStatusSchema,
  releaseUrl: z.string().nullable(),
  draftStatus: ExistingReleaseLookupStatusSchema,
  draftUrl: z.string().nullable(),
});
export type ExistingReleaseState = z.infer<typeof ExistingReleaseStateSchema>;
