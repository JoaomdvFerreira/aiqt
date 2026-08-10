import { z } from "zod";

/**
 * M48-WU01: the shared Night Audit contract. Contract-only, mirroring the
 * M42-WU01/M43-WU01/M45-WU01 precedent -- schemas and bounds live here;
 * queue planning (WU48-02), task execution (WU48-03), quality-gate/M42
 * intake (WU48-04), and GitHub Issue publication/session orchestration
 * (WU48-05) are added by later Work Units on top of this owner.
 *
 * Build spec Sec 4-7: `NightAuditCoverageEntry`/`NightAuditActiveSession`
 * are new, additive, optional top-level `StateModel` sections (see
 * state.schema.ts) -- no parallel `.aiqt/night-audit.*` file or database
 * exists anywhere. `AuditFinding` is a transient evidence object, never
 * persisted to canonical state or the runlog by review execution itself --
 * it mirrors M43's `StructuralFinding` discipline exactly (fingerprint
 * excludes the reviewed commit; `reviewCommit` is a separate freshness
 * binding) but is its own contract because M48's domains (code quality,
 * documentation, governance/config judgment) are not covered by
 * `structuralReviewContract`'s seven deterministic rule sets.
 */

const BOUNDED_SHORT = 500;
const BOUNDED_MEDIUM = 2000;
const BOUNDED_LOCATOR = 2048;

export const MAX_NIGHT_AUDIT_COVERAGE_ENTRIES = 2000;
export const MAX_AFFECTED_PATHS_PER_FINDING = 100;
export const MAX_EVIDENCE_ITEMS_PER_FINDING = 20;
export const MAX_NEW_ISSUES_PER_RESULT = 200;
export const MAX_AMBIGUOUS_RECONCILIATIONS = 100;
export const MAX_UNREVIEWED_SCOPE_ENTRIES = 200;

/**
 * Build spec Sec 5: the bounded, six-domain registry -- the exact set named
 * in the milestone brief, no more. `tests`/`repository_structure`/
 * `architecture` tasks may call through to `aiqt review structural` as one
 * evidence source (see structuralReviewEngine); `code_quality`/
 * `documentation`/`governance_config` have no deterministic rule-engine
 * equivalent and are agent-executed reads.
 */
export const NightReviewDomainSchema = z.enum([
  "code_quality",
  "tests",
  "documentation",
  "repository_structure",
  "architecture",
  "governance_config",
]);
export type NightReviewDomain = z.infer<typeof NightReviewDomainSchema>;

/** Build spec Sec 4: a portfolio member may SELECT the one repository a session targets. Provenance only, mirrors PullRequestPortfolioRefSchema -- membership is never write authority. */
export const NightAuditPortfolioRefSchema = z
  .object({
    portfolioId: z.string().min(1),
    memberId: z.string().min(1),
  })
  .strict();
export type NightAuditPortfolioRef = z.infer<typeof NightAuditPortfolioRefSchema>;

/**
 * Build spec Sec 4: explicit budget object. No product-policy default is
 * hard-coded into this schema -- a caller (CLI default or explicit flag)
 * must supply every field. `hardStopMinutes` is validated to be at least
 * `targetDurationMinutes` so the soft target can never exceed the ceiling
 * it is soft relative to.
 */
export const NightAuditSessionBudgetSchema = z
  .object({
    targetDurationMinutes: z.number().int().min(1),
    hardStopMinutes: z.number().int().min(1),
    maxReviewTasks: z.number().int().min(1),
    maxNewIssues: z.number().int().min(0),
    maxOpenAuditIssueBacklog: z.number().int().min(0),
    /** Build spec Sec 15: only enforced where a provider adapter exposes authoritative token telemetry. */
    maxContextTokensPerTask: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((budget) => budget.hardStopMinutes >= budget.targetDurationMinutes, {
    message: "hardStopMinutes must be greater than or equal to targetDurationMinutes.",
    path: ["hardStopMinutes"],
  });
export type NightAuditSessionBudget = z.infer<typeof NightAuditSessionBudgetSchema>;

/** Build spec Sec 4: running totals checked against the budget via an AND-of-limits function (WU48-02), mirroring autonomous-run-budget.ts's independent-dimension discipline. */
export const NightAuditSessionUsageSchema = z
  .object({
    elapsedMinutes: z.number().min(0),
    reviewTasksAttempted: z.number().int().min(0),
    reviewTasksCompleted: z.number().int().min(0),
    newIssuesCreated: z.number().int().min(0),
    /** Build spec Sec 10: the diminishing-return counter -- consecutive completed tasks producing zero accepted findings. */
    consecutiveTasksWithNoAcceptedFindings: z.number().int().min(0),
  })
  .strict();
export type NightAuditSessionUsage = z.infer<typeof NightAuditSessionUsageSchema>;

/**
 * Build spec Sec 9/13.2: the durable resumability anchor, a nullable
 * singleton (never an array) mirroring maintenanceActiveOccurrence -- "at
 * most one session running per project" is a structural property of the
 * state shape, not a runtime check. `budget` is persisted so a resumed/
 * reconciled session does not need the operator to re-supply it.
 */
export const NightAuditActiveSessionRecordSchema = z
  .object({
    sessionId: z.string().min(1),
    startedAt: z.string(),
    budget: NightAuditSessionBudgetSchema,
    usage: NightAuditSessionUsageSchema,
    portfolioRef: NightAuditPortfolioRefSchema.nullable(),
  })
  .strict();
export type NightAuditActiveSessionRecord = z.infer<typeof NightAuditActiveSessionRecordSchema>;

/**
 * Build spec Sec 6: "what was reviewed, at which commit, when, outcome,
 * whether findings were produced" -- one entry per (domain, scope) pair,
 * upserted after each completed ReviewTask. Lives inside the target
 * repository's own canonical state (never a separate home-scoped store):
 * coverage is per-project operational history, not cross-repository
 * membership or a Git/GitHub side-effect record.
 */
export const NightAuditCoverageEntrySchema = z
  .object({
    domain: NightReviewDomainSchema,
    scope: z.string().min(1).max(BOUNDED_LOCATOR),
    lastReviewedCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    lastReviewedAt: z.string(),
    outcomeSummary: z.string().min(1).max(BOUNDED_MEDIUM),
    findingsProduced: z.boolean(),
  })
  .strict();
export type NightAuditCoverageEntry = z.infer<typeof NightAuditCoverageEntrySchema>;

/**
 * Build spec Sec 5: one bounded review task -- one domain x one bounded
 * scope x one repository snapshot. Never added to the work graph, never
 * surfaced by `aiqt next`. The bounded context manifest built for
 * execution (WU48-03, reusing execution-context-manifest.ts's pure
 * primitives) is not part of this persisted identity.
 */
export const ReviewTaskSchema = z
  .object({
    taskId: z.string().min(1),
    domain: NightReviewDomainSchema,
    scope: z.string().min(1).max(BOUNDED_LOCATOR),
    repositoryCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  })
  .strict();
export type ReviewTask = z.infer<typeof ReviewTaskSchema>;

/**
 * Build spec Sec 8: the four evidence-quality tiers, and Sec 8's five-tier
 * significance classification -- deliberately distinct types from M42's
 * DefectConfidence/DefectSeverity and M43's StructuralFindingConfidence/
 * StructuralFindingSignificance, mirroring the same two-axis discipline
 * rather than reusing the enums verbatim (Sec 3.7-equivalent: a different
 * domain's confidence/significance are separate concepts even where the
 * vocabulary reads the same).
 */
export const AuditFindingConfidenceSchema = z.enum(["proven", "strong_signal", "weak_signal", "unsupported"]);
export type AuditFindingConfidence = z.infer<typeof AuditFindingConfidenceSchema>;

export const AuditFindingSignificanceSchema = z.enum(["critical", "high", "medium", "low", "informational"]);
export type AuditFindingSignificance = z.infer<typeof AuditFindingSignificanceSchema>;

export const AuditFindingDispositionSchema = z.enum(["actionable", "informational", "suppressed_benign_pattern"]);
export type AuditFindingDisposition = z.infer<typeof AuditFindingDispositionSchema>;

export const AuditFindingEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    description: z.string().min(1).max(BOUNDED_MEDIUM),
    locator: z.string().min(1).max(BOUNDED_LOCATOR),
  })
  .strict();
export type AuditFindingEvidence = z.infer<typeof AuditFindingEvidenceSchema>;

/**
 * Build spec Sec 7/8/9: one transient candidate observation from a
 * ReviewTask. `findingKey` is the deterministic dedup identity -- built
 * ONLY from domain + checkId + a bounded structural evidence signature
 * (never title/explanation text), mirroring computeDefectFingerprint /
 * computeStructuralFindingFingerprint exactly (see night-audit-fingerprint.ts,
 * WU48-04). `reviewCommit` is the separate freshness binding. Never
 * persisted to canonical StateModel or the runlog by review execution
 * itself -- a CommandResult.data payload only, exactly like
 * StructuralFinding.
 */
export const AuditFindingSchema = z
  .object({
    findingKey: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    domain: NightReviewDomainSchema,
    checkId: z.string().min(1).max(BOUNDED_SHORT),
    title: z.string().min(1).max(BOUNDED_SHORT),
    explanation: z.string().min(1).max(BOUNDED_MEDIUM),
    reviewCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    scope: z.string().min(1).max(BOUNDED_LOCATOR),
    affectedPaths: z.array(z.string().min(1).max(BOUNDED_LOCATOR)).max(MAX_AFFECTED_PATHS_PER_FINDING),
    evidence: z.array(AuditFindingEvidenceSchema).min(1).max(MAX_EVIDENCE_ITEMS_PER_FINDING),
    confidence: AuditFindingConfidenceSchema,
    significance: AuditFindingSignificanceSchema,
    disposition: AuditFindingDispositionSchema,
    recommendedNextAction: z.string().min(1).max(BOUNDED_MEDIUM),
    validationIdea: z.string().min(1).max(BOUNDED_MEDIUM).optional(),
  })
  .strict();
export type AuditFinding = z.infer<typeof AuditFindingSchema>;

/**
 * M48-WU03: what an executing agent (or the structural-review call-through)
 * submits for one ReviewTask -- everything AuditFinding needs EXCEPT
 * `findingKey` (computed by WU48-04's fingerprint function, never supplied
 * by the submitter) and `domain`/`reviewCommit`/`scope` (always taken from
 * the ReviewTask itself, never re-supplied, so a submission cannot claim a
 * different scope than the task it was issued for).
 */
export const AuditFindingCandidateInputSchema = z
  .object({
    checkId: z.string().min(1).max(BOUNDED_SHORT),
    title: z.string().min(1).max(BOUNDED_SHORT),
    explanation: z.string().min(1).max(BOUNDED_MEDIUM),
    affectedPaths: z.array(z.string().min(1).max(BOUNDED_LOCATOR)).max(MAX_AFFECTED_PATHS_PER_FINDING),
    evidence: z.array(AuditFindingEvidenceSchema).min(1).max(MAX_EVIDENCE_ITEMS_PER_FINDING),
    confidence: AuditFindingConfidenceSchema,
    significance: AuditFindingSignificanceSchema,
    disposition: AuditFindingDispositionSchema,
    recommendedNextAction: z.string().min(1).max(BOUNDED_MEDIUM),
    validationIdea: z.string().min(1).max(BOUNDED_MEDIUM).optional(),
  })
  .strict();
export type AuditFindingCandidateInput = z.infer<typeof AuditFindingCandidateInputSchema>;

export const MAX_SUBMITTED_FINDINGS_PER_TASK = 20;

/** M48-WU03: the bounded envelope one ReviewTask submission carries -- never an unbounded list, and never raw agent reasoning/log text alongside it. */
export const ReviewTaskSubmissionSchema = z
  .object({
    taskId: z.string().min(1),
    findings: z.array(AuditFindingCandidateInputSchema).max(MAX_SUBMITTED_FINDINGS_PER_TASK),
  })
  .strict();
export type ReviewTaskSubmission = z.infer<typeof ReviewTaskSubmissionSchema>;

/** Build spec Sec 14: explainable, pre-named stop reasons -- never an opaque "the model decided it was done". */
export const NightAuditStopReasonSchema = z.enum([
  "budget_exhausted",
  "queue_exhausted",
  "diminishing_returns",
  "hard_stop",
  "cancelled",
]);
export type NightAuditStopReason = z.infer<typeof NightAuditStopReasonSchema>;

export const NightAuditDuplicatesSuppressedSchema = z
  .object({
    byFingerprint: z.number().int().min(0),
    byExistingIssueRef: z.number().int().min(0),
    byGithubSearch: z.number().int().min(0),
  })
  .strict();
export type NightAuditDuplicatesSuppressed = z.infer<typeof NightAuditDuplicatesSuppressedSchema>;

export const NightAuditCreatedIssueRefSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.string().min(1),
  })
  .strict();
export type NightAuditCreatedIssueRef = z.infer<typeof NightAuditCreatedIssueRefSchema>;

/**
 * Build spec Sec 14: the primary operator-facing "morning result" --
 * transient CommandResult.data only, never persisted verbatim (the durable
 * facts it summarizes live in nightAuditCoverage / the defect list /
 * the runlog).
 */
export const NightAuditResultSchema = z
  .object({
    sessionId: z.string().min(1),
    startedAt: z.string(),
    finishedAt: z.string(),
    stopReason: NightAuditStopReasonSchema,
    tasksAttempted: z.number().int().min(0),
    tasksCompleted: z.number().int().min(0),
    domainsReviewed: z.array(NightReviewDomainSchema),
    candidateFindings: z.number().int().min(0),
    acceptedFindings: z.number().int().min(0),
    rejectedFindings: z.number().int().min(0),
    duplicatesSuppressed: NightAuditDuplicatesSuppressedSchema,
    newIssuesCreated: z.array(NightAuditCreatedIssueRefSchema).max(MAX_NEW_ISSUES_PER_RESULT),
    issuePublicationSuppressed: z.boolean(),
    currentAuditIssueBacklog: z.number().int().min(0),
    budgetRemaining: NightAuditSessionUsageSchema,
    unreviewedHighPriorityScope: z.array(z.string().min(1).max(BOUNDED_LOCATOR)).max(MAX_UNREVIEWED_SCOPE_ENTRIES),
    ambiguousReconciliationsNeeded: z.array(z.string().min(1).max(BOUNDED_MEDIUM)).max(MAX_AMBIGUOUS_RECONCILIATIONS),
  })
  .strict();
export type NightAuditResult = z.infer<typeof NightAuditResultSchema>;
