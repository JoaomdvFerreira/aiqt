import { z } from "zod";

/**
 * M47-WU01: the Pull Request integration contract. One
 * `PullRequestIntegrationPlan` binds exactly one repository, one remote,
 * one base branch, one source branch, one exact commit SHA, and at most
 * one Pull Request (build spec Sec 7/19). It is the durable record of
 * every remote side effect M47 may cause, so that an interrupted,
 * ambiguous, or partially-applied operation can be reconciled on a later
 * invocation rather than guessed at or duplicated.
 *
 * State-boundary decision (build spec Sec 7). M37's `AutonomousRunRecord`
 * (src/schema/autonomous-run-record.schema.ts) was inspected first, as the
 * milestone prompt requires. It cannot own these facts: it is `.strict()`
 * and structurally bound to an autonomous *repair run* (candidate, safety
 * assessment, budgets, execution policy, sandbox evidence), while a PR
 * integration has none of those and must work for any already-prepared
 * branch, including branches no autonomous run ever produced. Widening
 * that schema would make every autonomous run carry PR fields it can
 * never populate. So M47 adds the smallest separate canonical record
 * instead -- one plan per file, same store discipline as
 * autonomous-run-store.ts / portfolio-store.ts.
 *
 * This is its own schema/version domain, exactly like M46's
 * PORTFOLIO_SCHEMA_VERSION: introducing or changing it never bumps
 * AIQT_SCHEMA_VERSION (src/core/constants/schema-version.ts), which
 * versions the canonical `.aiqt` project/state contract that M47 does not
 * touch at all. There is deliberately no `.aiqt/pr.json` or any other
 * parallel state database inside a managed repository.
 */

export const PR_INTEGRATION_SCHEMA_VERSION = "1.0.0" as const;

/** Bounds the reviewer set a single plan may request (explicit reviewers only -- there is no discovery path that could grow this). */
export const MAX_PR_REVIEWERS = 15;

/** Bounds PR metadata read from operator input before it is ever digested or sent. */
export const MAX_PR_TITLE_CHARS = 256;
export const MAX_PR_BODY_CHARS = 65536;

/**
 * The only provider M47 implements. A fixed enum rather than a free-form
 * string: a provider id is a reviewed integration, never operator input
 * (mirrors AUTONOMOUS_AGENT_PROVIDER_ID's fixed-literal discipline).
 */
export const PullRequestProviderSchema = z.enum(["github"]);
export type PullRequestProvider = z.infer<typeof PullRequestProviderSchema>;

/** `draft` is the safe default (build spec Sec 10); `ready` requires explicit operator intent. */
export const PullRequestCreateModeSchema = z.enum(["draft", "ready"]);
export type PullRequestCreateMode = z.infer<typeof PullRequestCreateModeSchema>;

/**
 * Build spec Sec 11: base-branch protection evidence is reported honestly.
 * `unverifiable` (permission denied, API failure, plan limitation) is never
 * collapsed into `unprotected` -- "we could not check" and "we checked and
 * it is not protected" are different facts with different safety meaning.
 * `unsupported` means the provider has no protection concept to report at
 * all.
 */
export const BaseProtectionEvidenceSchema = z.enum(["protected", "unprotected", "unverifiable", "unsupported"]);
export type BaseProtectionEvidence = z.infer<typeof BaseProtectionEvidenceSchema>;

/** Same honesty rule for remote branch existence: `unverifiable` is never silently treated as `absent` (which would authorize a create-style push). */
export const RemoteBranchPresenceSchema = z.enum(["present", "absent", "unverifiable"]);
export type RemoteBranchPresence = z.infer<typeof RemoteBranchPresenceSchema>;

/**
 * Plan status. `push_ambiguous`/`pr_ambiguous` are first-class, not error
 * states: they mean a remote write was attempted and its outcome is
 * genuinely unknown, so the next invocation must look up real remote state
 * before doing anything else (build spec Sec 8/10). `blocked` is only ever
 * reached from `prepared` -- see markPlanBlocked in
 * src/workflow/pr-integration-lifecycle.ts.
 */
export const PullRequestIntegrationStatusSchema = z.enum([
  "prepared",
  "push_verified",
  "push_ambiguous",
  "pr_open",
  "pr_ambiguous",
  "blocked",
]);
export type PullRequestIntegrationStatus = z.infer<typeof PullRequestIntegrationStatusSchema>;

export const PullRequestPushOutcomeSchema = z.enum(["verified", "ambiguous", "failed"]);
export type PullRequestPushOutcome = z.infer<typeof PullRequestPushOutcomeSchema>;

/**
 * The record of the one push M47 may perform. `remoteShaAfter` is the SHA
 * re-read FROM the remote after the write, not the SHA that was sent --
 * `verified` requires exact equality between the two (build spec Sec 8).
 */
export const PullRequestPushRecordSchema = z
  .object({
    attemptedAt: z.string().min(1),
    outcome: PullRequestPushOutcomeSchema,
    /** The exact commit the plan bound at prepare time -- the only commit that may ever be pushed. */
    plannedSha: z.string().min(1),
    /** Remote source SHA re-read after the write. Null when it could not be read (which is exactly what makes an outcome `ambiguous`). */
    remoteShaAfter: z.string().min(1).nullable(),
    remoteBranchPresenceBefore: RemoteBranchPresenceSchema,
    detail: z.string().min(1),
  })
  .strict();
export type PullRequestPushRecord = z.infer<typeof PullRequestPushRecordSchema>;

/** Whether this plan's PR was newly created by AIQT, or an already-existing matching PR that was reconciled onto the plan (build spec Sec 10: never duplicate). */
export const PullRequestOriginSchema = z.enum(["created", "reconciled"]);
export type PullRequestOrigin = z.infer<typeof PullRequestOriginSchema>;

export const PullRequestStateSchema = z.enum(["open", "closed", "merged", "unknown"]);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

/**
 * `merged` is an observable fact about a PR someone else merged -- it is
 * never an outcome M47 can produce. Nothing in this milestone writes a
 * merge, and no schema field authorizes one.
 */
export const PullRequestRecordSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.string().min(1),
    state: PullRequestStateSchema,
    isDraft: z.boolean(),
    /** Head SHA as reported by the provider, or null when the provider response did not carry one. */
    headSha: z.string().min(1).nullable(),
    baseBranch: z.string().min(1),
    sourceBranch: z.string().min(1),
    origin: PullRequestOriginSchema,
    recordedAt: z.string().min(1),
  })
  .strict();
export type PullRequestRecord = z.infer<typeof PullRequestRecordSchema>;

/**
 * Build spec Sec 10: reviewer assignment is a separate side effect from PR
 * creation, so "PR created, reviewers not assigned" is a typed partial
 * state that a retry can complete WITHOUT creating a second PR. `partial`
 * means the provider accepted some logins and rejected others.
 */
export const ReviewerRequestOutcomeSchema = z.enum(["not_requested", "succeeded", "partial", "failed"]);
export type ReviewerRequestOutcome = z.infer<typeof ReviewerRequestOutcomeSchema>;

export const ReviewerRequestRecordSchema = z
  .object({
    attemptedAt: z.string().min(1).nullable(),
    outcome: ReviewerRequestOutcomeSchema,
    /** The logins this plan asked for -- always the plan's own explicit reviewer set, never a discovered one. */
    requested: z.array(z.string().min(1)),
    /** The logins the provider confirmed as requested reviewers. */
    confirmed: z.array(z.string().min(1)),
    detail: z.string().min(1).nullable(),
  })
  .strict();
export type ReviewerRequestRecord = z.infer<typeof ReviewerRequestRecordSchema>;

export const BaseProtectionRecordSchema = z
  .object({
    evidence: BaseProtectionEvidenceSchema,
    checkedAt: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();
export type BaseProtectionRecord = z.infer<typeof BaseProtectionRecordSchema>;

export const PullRequestIntegrationPolicySchema = z
  .object({
    /** When true, only a verified `protected` base may proceed to create (build spec Sec 11). */
    requireProtectedBase: z.boolean(),
  })
  .strict();
export type PullRequestIntegrationPolicy = z.infer<typeof PullRequestIntegrationPolicySchema>;

/**
 * Build spec Sec 12: an M46 portfolio member may be used to SELECT the one
 * repository a plan targets. Recording which member was selected is
 * provenance only -- portfolio membership is never write authority, and
 * one plan is always one repository.
 */
export const PullRequestPortfolioRefSchema = z
  .object({
    portfolioId: z.string().min(1),
    memberId: z.string().min(1),
  })
  .strict();
export type PullRequestPortfolioRef = z.infer<typeof PullRequestPortfolioRefSchema>;

export const PR_INTEGRATION_EVENT_TYPES = [
  "prepared",
  "preflight_blocked",
  "stale_detected",
  "push_attempted",
  "push_verified",
  "push_ambiguous",
  "push_failed",
  "pr_lookup",
  "pr_created",
  "pr_reconciled",
  "pr_create_ambiguous",
  "pr_create_failed",
  "reviewers_requested",
  "reviewers_failed",
  "base_protection_recorded",
  "validated",
] as const;

export const PullRequestIntegrationEventTypeSchema = z.enum(PR_INTEGRATION_EVENT_TYPES);
export type PullRequestIntegrationEventType = z.infer<typeof PullRequestIntegrationEventTypeSchema>;

export const PullRequestIntegrationAuditEntrySchema = z
  .object({
    event: PullRequestIntegrationEventTypeSchema,
    at: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();
export type PullRequestIntegrationAuditEntry = z.infer<typeof PullRequestIntegrationAuditEntrySchema>;

/**
 * One plan == one repository + one remote + one base + one source + one
 * exact SHA + at most one PR (build spec Sec 19). Every field above
 * `bindingDigest` is a write-relevant fact: if any of them changes after
 * the plan was prepared, the plan is stale and no remote write may proceed
 * (src/workflow/pr-integration-identity.ts).
 */
export const PullRequestIntegrationPlanSchema = z
  .object({
    schemaVersion: z.string(),
    id: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    status: PullRequestIntegrationStatusSchema,

    // --- write-relevant binding facts -------------------------------------
    provider: PullRequestProviderSchema,
    /** Canonicalized absolute path to the target repository root. Never this repository (the AIQT product) -- guarded at every command entry point. */
    repositoryRoot: z.string().min(1),
    remoteName: z.string().min(1),
    /** "owner/repo" as resolved from the remote URL and confirmed against the provider. */
    remoteRepositoryIdentity: z.string().min(1),
    baseBranch: z.string().min(1),
    sourceBranch: z.string().min(1),
    /** The exact 40-hex local HEAD commit bound at prepare time -- the only commit this plan may ever push. */
    sourceHeadSha: z.string().min(1),
    title: z.string().min(1).max(MAX_PR_TITLE_CHARS),
    /**
     * M47-WU04: the exact body that will be sent, persisted so that
     * `pr create` can complete or resume without the operator re-supplying
     * byte-identical text. Requiring re-supply would make resumption
     * fragile in exactly the situation resumption exists for: a body that
     * differed by a single newline would read as staleness and force a new
     * plan even when a Pull Request may already exist.
     */
    body: z.string().max(MAX_PR_BODY_CHARS),
    /** sha256 digest over the exact title+body that will be sent -- the value freshness is decided on. */
    metadataDigest: z.string().min(1),
    /** Normalized (trimmed, de-duplicated case-insensitively, sorted) explicit reviewer logins. */
    reviewers: z.array(z.string().min(1)).max(MAX_PR_REVIEWERS),
    createMode: PullRequestCreateModeSchema,
    policy: PullRequestIntegrationPolicySchema,

    /** sha256 over the normalized form of every write-relevant fact above. Recomputed and compared before every remote write. */
    bindingDigest: z.string().min(1),

    // --- provenance and recorded side effects ------------------------------
    portfolioRef: PullRequestPortfolioRefSchema.nullable(),
    push: PullRequestPushRecordSchema.nullable(),
    pullRequest: PullRequestRecordSchema.nullable(),
    reviewerRequest: ReviewerRequestRecordSchema.nullable(),
    baseProtection: BaseProtectionRecordSchema.nullable(),
    auditLog: z.array(PullRequestIntegrationAuditEntrySchema),
  })
  .strict();
export type PullRequestIntegrationPlan = z.infer<typeof PullRequestIntegrationPlanSchema>;
