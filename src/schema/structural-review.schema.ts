import { z } from "zod";

/**
 * M43-WU01: the structural-review contract. Contract-only, mirroring the
 * M36-WU01/M38-WU01/M42-WU01 precedent. Transient evidence objects only --
 * NOT part of canonical StateModel, never written to state.json/runlog by
 * a read-only review (Section 3.1). A StructuralFinding is never itself a
 * DefectRecord; M43 intake (WU43-04) adapts a selected finding into the
 * existing M42 defect contract instead of duplicating it (Section 3.3).
 */

const BOUNDED_SHORT = 500;
const BOUNDED_MEDIUM = 2000;
const BOUNDED_LOCATOR = 2048;

export const MAX_FINDINGS = 2000;
export const MAX_EVIDENCE_ITEMS_PER_FINDING = 20;
export const MAX_AFFECTED_PATHS = 100;
export const MAX_REASON_CODES = 20;

/** Section 4: the bounded structural-review domain registry -- not one generic scanner. */
export const StructuralReviewDomainSchema = z.enum([
  "ownership_divergence",
  "dependency_coupling",
  "responsibility_concentration",
  "dead_structural_paths",
  "public_contract_drift",
  "test_infrastructure",
  "execution_safety_boundary",
]);
export type StructuralReviewDomain = z.infer<typeof StructuralReviewDomainSchema>;

/**
 * Section 5.2: the four evidence-quality tiers a finding must distinguish.
 * Deliberately a distinct type from M42's DefectConfidence (Section 3.7:
 * structural confidence and defect confidence are separate domains, even
 * where their vocabulary looks similar).
 */
export const StructuralFindingConfidenceSchema = z.enum([
  "proven",
  "strong_signal",
  "weak_signal",
  "unsupported",
]);
export type StructuralFindingConfidence = z.infer<typeof StructuralFindingConfidenceSchema>;

/**
 * Structural impact classification -- distinct from DefectSeverity
 * (Section 3.7: "defect severity after M42 intake" is a separate concept
 * decided only after intake, never inherited verbatim from significance).
 */
export const StructuralFindingSignificanceSchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "informational",
]);
export type StructuralFindingSignificance = z.infer<typeof StructuralFindingSignificanceSchema>;

/** Section 6.3/6.2: whether a finding is actionable, purely informational, or suppressed as a known benign pattern. */
export const StructuralFindingDispositionSchema = z.enum([
  "actionable",
  "informational",
  "suppressed_benign_pattern",
]);
export type StructuralFindingDisposition = z.infer<typeof StructuralFindingDispositionSchema>;

export const StructuralFindingEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    description: z.string().min(1).max(BOUNDED_MEDIUM),
    locator: z.string().min(1).max(BOUNDED_LOCATOR),
  })
  .strict();
export type StructuralFindingEvidence = z.infer<typeof StructuralFindingEvidenceSchema>;

/**
 * Section 3.2/6.3: one structural observation. `findingKey` is the
 * deterministic dedup/consolidation identity (domain+rule+evidence
 * structural identity -- never includes `reviewCommit`, so the same real
 * structural condition keeps the same key across commits and can be
 * consolidated/tracked over time). `reviewCommit` is the separate
 * freshness binding Section 3.4 requires -- WU43-04 intake compares it
 * against the current HEAD, not the finding key.
 */
export const StructuralFindingSchema = z
  .object({
    findingKey: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    domain: StructuralReviewDomainSchema,
    ruleId: z.string().min(1).max(BOUNDED_SHORT),
    title: z.string().min(1).max(BOUNDED_SHORT),
    explanation: z.string().min(1).max(BOUNDED_MEDIUM),
    reviewCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    affectedPaths: z.array(z.string().min(1).max(BOUNDED_LOCATOR)).max(MAX_AFFECTED_PATHS),
    affectedOwners: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_AFFECTED_PATHS).optional(),
    evidence: z.array(StructuralFindingEvidenceSchema).min(1).max(MAX_EVIDENCE_ITEMS_PER_FINDING),
    confidence: StructuralFindingConfidenceSchema,
    significance: StructuralFindingSignificanceSchema,
    reasonCodes: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_REASON_CODES),
    evidenceGaps: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_REASON_CODES),
    disposition: StructuralFindingDispositionSchema,
    eligibleForIntake: z.boolean(),
    recommendedNextAction: z.string().min(1).max(BOUNDED_MEDIUM),
    /** Section 3.6: "repository-local" for the core deterministic rules, or a named optional provider id. */
    providerSource: z.string().min(1).max(BOUNDED_SHORT),
    /** Section 6.1: consolidation provenance -- the set of raw signal ids folded into this finding. Preserved, never discarded. */
    consolidatedFrom: z.array(z.string().min(1)).max(MAX_EVIDENCE_ITEMS_PER_FINDING).optional(),
  })
  .strict();
export type StructuralFinding = z.infer<typeof StructuralFindingSchema>;

/** Section 3.6: an optional evidence provider's participation/availability status for one review run. */
export const StructuralProviderStatusSchema = z
  .object({
    providerId: z.string().min(1),
    available: z.boolean(),
    reason: z.string().max(BOUNDED_MEDIUM).optional(),
  })
  .strict();
export type StructuralProviderStatus = z.infer<typeof StructuralProviderStatusSchema>;

export const StructuralDomainUnsupportedSchema = z
  .object({
    domain: z.string().min(1),
    reason: z.string().min(1).max(BOUNDED_MEDIUM),
  })
  .strict();
export type StructuralDomainUnsupported = z.infer<typeof StructuralDomainUnsupportedSchema>;

/**
 * Section 3.1/7: the full result of one review run. Never persisted to
 * canonical StateModel or the runlog -- a transient CommandResult.data
 * payload only. `domainsSupported`/`domainsUnsupported` make an
 * unrecognized or not-yet-implemented domain explicit rather than
 * silently ignored.
 */
export const StructuralReviewSchema = z
  .object({
    reviewCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    generatedAt: z.string(),
    domainsRequested: z.array(StructuralReviewDomainSchema),
    domainsSupported: z.array(StructuralReviewDomainSchema),
    domainsUnsupported: z.array(StructuralDomainUnsupportedSchema),
    providerStatus: z.array(StructuralProviderStatusSchema),
    findings: z.array(StructuralFindingSchema).max(MAX_FINDINGS),
  })
  .strict();
export type StructuralReview = z.infer<typeof StructuralReviewSchema>;
