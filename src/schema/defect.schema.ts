import { z } from "zod";

/**
 * M42-WU01: the shared defect/remediation-queue contract. Contract-only,
 * mirroring M36-WU01/M38-WU01's precedent -- schemas, bounds, and pure
 * transition data live here; discovery/triage/remediation logic is added
 * by later Work Units on top of this owner. No parallel `.aiqt/defects.*`
 * file or database exists anywhere; this section lives inside the
 * canonical `StateModel` (see `state.schema.ts`).
 */

const BOUNDED_SHORT = 500;
const BOUNDED_MEDIUM = 2000;
const BOUNDED_LOCATOR = 2048;

export const MAX_DEFECTS = 5000;
export const MAX_EVIDENCE_REFS_PER_DEFECT = 50;
export const MAX_AFFECTED_FILES = 100;
export const MAX_REASON_CODES = 20;
export const MAX_EVIDENCE_GAPS = 20;
export const MAX_DUPLICATE_LINKS = 50;

/** Section 5: the bounded set of evidence sources M42 discovery may consume. */
export const DefectSourceKindSchema = z.enum([
  "failed_validation",
  "checkpoint_issue",
  "review_finding",
  "autonomous_execution_failure",
  "imported_external_evidence",
  "human_reported",
]);
export type DefectSourceKind = z.infer<typeof DefectSourceKindSchema>;

/** Section 4.2: the bounded defect lifecycle. Exact transitions in defect-transitions.ts. */
export const DefectStatusSchema = z.enum([
  "candidate",
  "triaged",
  "queued",
  "in_progress",
  "needs_human",
  "deferred",
  "resolved",
  "reopened",
  "invalid",
  "duplicate",
]);
export type DefectStatus = z.infer<typeof DefectStatusSchema>;

export const DefectSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type DefectSeverity = z.infer<typeof DefectSeveritySchema>;

/**
 * Section 3.2/4.1: reproducibility/confidence state, distinct from severity.
 * `insufficient_evidence` is the required "do not fabricate certainty" floor
 * (Section 6.3 / Definition of Done item 9's low-confidence handling).
 */
export const DefectConfidenceSchema = z.enum([
  "confirmed",
  "probable",
  "suspected",
  "insufficient_evidence",
]);
export type DefectConfidence = z.infer<typeof DefectConfidenceSchema>;

/** Section 6.3: who may authorize remediation, distinct from defect severity (Section 3.4). */
export const DefectApprovalAuthoritySchema = z.enum(["automation", "human_required"]);
export type DefectApprovalAuthority = z.infer<typeof DefectApprovalAuthoritySchema>;

/** Section 5: evidence freshness state. Stale evidence is never a silent current confirmation. */
export const DefectFreshnessStateSchema = z.enum(["current", "stale", "unknown"]);
export type DefectFreshnessState = z.infer<typeof DefectFreshnessStateSchema>;

/**
 * A bounded reference to existing evidence -- never a copy of raw chat
 * history, log bodies, or artifact content (Section 4.1). `evidenceRecordId`
 * links to an existing `EvidenceRecord` (M22) when the source produced one;
 * `locator` carries a bounded description for sources that do not (e.g. a
 * bare focused-test-run result) so the reference is still traceable.
 */
export const DefectEvidenceRefSchema = z
  .object({
    evidenceRefId: z.string().min(1),
    sourceKind: DefectSourceKindSchema,
    evidenceRecordId: z.string().min(1).optional(),
    locator: z.string().min(1).max(BOUNDED_LOCATOR),
    capturedAt: z.string(),
    description: z.string().max(BOUNDED_MEDIUM).optional(),
  })
  .strict();
export type DefectEvidenceRef = z.infer<typeof DefectEvidenceRefSchema>;

export const DefectFreshnessSchema = z
  .object({
    state: DefectFreshnessStateSchema,
    evaluatedAt: z.string(),
    reason: z.string().max(BOUNDED_MEDIUM).optional(),
  })
  .strict();
export type DefectFreshness = z.infer<typeof DefectFreshnessSchema>;

/** Section 6.1: the explainable triage output, attached to a DefectRecord once triaged. */
export const DefectTriageDecisionSchema = z
  .object({
    severity: DefectSeveritySchema,
    confidence: DefectConfidenceSchema,
    reproducibility: DefectConfidenceSchema,
    priority: z.number().int().min(0),
    queueDisposition: z.enum(["queue", "defer", "invalidate", "needs_human", "duplicate"]),
    approvalAuthority: DefectApprovalAuthoritySchema,
    reasonCodes: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_REASON_CODES),
    evidenceGaps: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_EVIDENCE_GAPS),
    recommendedNextAction: z.string().min(1).max(BOUNDED_MEDIUM),
    decidedAt: z.string(),
  })
  .strict();
export type DefectTriageDecision = z.infer<typeof DefectTriageDecisionSchema>;

/**
 * Section 8: a bounded remediation request/decision, distinct from defect
 * severity (Section 3.4) -- `remediationRiskScore`/`remediationRiskBand` use
 * the repository four-band implementation-risk scale, never the defect's
 * own severity/confidence fields.
 */
export const RemediationRiskBandSchema = z.enum(["green", "yellow", "orange", "red"]);
export type RemediationRiskBand = z.infer<typeof RemediationRiskBandSchema>;

export const RemediationOutcomeSchema = z.enum([
  "not_started",
  "pending_human_approval",
  "in_progress",
  "validation_failed",
  "validation_passed",
  "cancelled",
]);
export type RemediationOutcome = z.infer<typeof RemediationOutcomeSchema>;

export const RemediationDecisionSchema = z
  .object({
    remediationId: z.string().min(1),
    objective: z.string().min(1).max(BOUNDED_MEDIUM),
    scope: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_AFFECTED_FILES),
    outOfScope: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_AFFECTED_FILES),
    acceptanceContract: z.string().min(1).max(BOUNDED_MEDIUM),
    remediationRiskScore: z.number().int().min(0).max(100),
    remediationRiskBand: RemediationRiskBandSchema,
    approvalRequired: z.boolean(),
    approvedBy: z.string().min(1).optional(),
    approvedAt: z.string().optional(),
    executionRef: z.string().min(1).optional(),
    outcome: RemediationOutcomeSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type RemediationDecision = z.infer<typeof RemediationDecisionSchema>;

export const RemediationEvidenceSchema = z
  .object({
    remediationId: z.string().min(1),
    validationOutcome: z.enum(["passed", "failed", "not_run"]),
    evidenceRefs: z.array(DefectEvidenceRefSchema).max(MAX_EVIDENCE_REFS_PER_DEFECT),
    recordedAt: z.string(),
    note: z.string().max(BOUNDED_MEDIUM).optional(),
  })
  .strict();
export type RemediationEvidence = z.infer<typeof RemediationEvidenceSchema>;

export const DefectResolutionSchema = z
  .object({
    resolvedAt: z.string(),
    evidenceRefs: z.array(DefectEvidenceRefSchema).max(MAX_EVIDENCE_REFS_PER_DEFECT),
    note: z.string().max(BOUNDED_MEDIUM).optional(),
  })
  .strict();
export type DefectResolution = z.infer<typeof DefectResolutionSchema>;

/** Section 4: the durable defect record. One canonical record per fingerprint. */
export const DefectRecordSchema = z
  .object({
    defectId: z.string().min(1),
    title: z.string().min(1).max(BOUNDED_SHORT),
    summary: z.string().min(1).max(BOUNDED_MEDIUM),
    sourceKind: DefectSourceKindSchema,
    evidenceRefs: z.array(DefectEvidenceRefSchema).min(1).max(MAX_EVIDENCE_REFS_PER_DEFECT),
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    severity: DefectSeveritySchema,
    confidence: DefectConfidenceSchema,
    affectedMilestoneId: z.string().min(1).optional(),
    affectedWorkUnitId: z.string().min(1).optional(),
    affectedFiles: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_AFFECTED_FILES).optional(),
    affectedValidationTargets: z.array(z.string().min(1).max(BOUNDED_SHORT)).max(MAX_AFFECTED_FILES).optional(),
    status: DefectStatusSchema,
    freshness: DefectFreshnessSchema,
    triage: DefectTriageDecisionSchema.optional(),
    remediation: RemediationDecisionSchema.optional(),
    remediationEvidence: z.array(RemediationEvidenceSchema).max(MAX_EVIDENCE_REFS_PER_DEFECT).optional(),
    resolution: DefectResolutionSchema.optional(),
    duplicateOfDefectId: z.string().min(1).optional(),
    supersedesDefectIds: z.array(z.string().min(1)).max(MAX_DUPLICATE_LINKS).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type DefectRecord = z.infer<typeof DefectRecordSchema>;

/**
 * M42-WU01: new, optional, top-level state section -- same additive pattern
 * as `state.evidence`/`state.workspace`. Missing entirely on pre-M42 state
 * files; never materialized by a read-only command. `defects` IS the
 * remediation queue -- a `RemediationQueueEntry` is simply a `DefectRecord`
 * whose `status` is queue-eligible (see defect-transitions.ts), not a
 * second parallel list.
 */
export const DefectStateSchema = z
  .object({
    defects: z.array(DefectRecordSchema).max(MAX_DEFECTS),
  })
  .strict();
export type DefectState = z.infer<typeof DefectStateSchema>;
