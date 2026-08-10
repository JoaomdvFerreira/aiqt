import {
  PR_INTEGRATION_SCHEMA_VERSION,
  type PullRequestIntegrationPlan,
  type PullRequestIntegrationAuditEntry,
  type PullRequestIntegrationEventType,
  type PullRequestPushRecord,
  type PullRequestRecord,
  type ReviewerRequestRecord,
  type BaseProtectionRecord,
  type PullRequestIntegrationStatus,
} from "../schema/pull-request-integration.schema.js";
import { computePrWriteBindingDigest, type PullRequestWriteBindingFacts } from "./pr-integration-identity.js";

/**
 * M47-WU01: pure plan transitions. Every function returns a NEW plan --
 * nothing here reads or writes a file, contacts a network, or spawns a
 * process; persistence is the store's job (src/state/pr-integration-store.ts)
 * and remote effects belong to the later Work Units.
 *
 * The single invariant these transitions exist to enforce (build spec Sec
 * 19: "partial side effects resumable"): a status that records a real
 * remote side effect is never downgraded. Once a push is verified or a PR
 * is known to exist, no later local decision can rewrite the plan into a
 * state that implies the side effect never happened -- otherwise a restart
 * could push or create twice.
 */

const MAX_AUDIT_ENTRIES = 200;

export function appendPlanAudit(
  plan: PullRequestIntegrationPlan,
  event: PullRequestIntegrationEventType,
  at: string,
  detail: string,
): PullRequestIntegrationPlan {
  const entry: PullRequestIntegrationAuditEntry = { event, at, detail };
  // Oldest entries are dropped first: the most recent reconciliation
  // history is what a resuming invocation actually needs, and the log is
  // never the authority for whether a side effect happened (the typed
  // push/pullRequest/reviewerRequest records are).
  const auditLog = [...plan.auditLog, entry].slice(-MAX_AUDIT_ENTRIES);
  return { ...plan, auditLog, updatedAt: at };
}

export interface CreatePlanInput {
  id: string;
  now: string;
  facts: PullRequestWriteBindingFacts;
  title: string;
  portfolioRef: PullRequestIntegrationPlan["portfolioRef"];
}

/**
 * A freshly prepared plan has recorded no remote side effect of any kind.
 * `pr prepare` is read-only by contract, so this is the only shape a plan
 * can be born in.
 */
export function createIntegrationPlan(input: CreatePlanInput): PullRequestIntegrationPlan {
  const plan: PullRequestIntegrationPlan = {
    schemaVersion: PR_INTEGRATION_SCHEMA_VERSION,
    id: input.id,
    createdAt: input.now,
    updatedAt: input.now,
    status: "prepared",
    provider: input.facts.provider,
    repositoryRoot: input.facts.repositoryRoot,
    remoteName: input.facts.remoteName,
    remoteRepositoryIdentity: input.facts.remoteRepositoryIdentity,
    baseBranch: input.facts.baseBranch,
    sourceBranch: input.facts.sourceBranch,
    sourceHeadSha: input.facts.sourceHeadSha,
    title: input.title,
    metadataDigest: input.facts.metadataDigest,
    reviewers: [...input.facts.reviewers],
    createMode: input.facts.createMode,
    policy: input.facts.policy,
    bindingDigest: computePrWriteBindingDigest(input.facts),
    portfolioRef: input.portfolioRef,
    push: null,
    pullRequest: null,
    reviewerRequest: null,
    baseProtection: null,
    auditLog: [],
  };
  return appendPlanAudit(plan, "prepared", input.now, `Prepared integration plan for ${plan.remoteRepositoryIdentity} ${plan.sourceBranch} -> ${plan.baseBranch} at ${plan.sourceHeadSha}.`);
}

/** True once this plan has caused any remote side effect whose existence must survive every later transition. */
export function hasRecordedRemoteSideEffect(plan: PullRequestIntegrationPlan): boolean {
  return plan.push !== null || plan.pullRequest !== null;
}

function statusForPushOutcome(outcome: PullRequestPushRecord["outcome"], previous: PullRequestIntegrationStatus): PullRequestIntegrationStatus {
  if (outcome === "verified") return "push_verified";
  if (outcome === "ambiguous") return "push_ambiguous";
  // A `failed` push is one we KNOW did not land (the remote refused it, or
  // a preflight gate refused before any bytes were sent). The plan returns
  // to whatever it was, rather than claiming a side effect it does not have.
  return previous === "prepared" ? "prepared" : previous;
}

export function recordPushOutcome(plan: PullRequestIntegrationPlan, record: PullRequestPushRecord, at: string): PullRequestIntegrationPlan {
  const event: PullRequestIntegrationEventType =
    record.outcome === "verified" ? "push_verified" : record.outcome === "ambiguous" ? "push_ambiguous" : "push_failed";
  const next: PullRequestIntegrationPlan = {
    ...plan,
    // A recorded push is never cleared by a later failed attempt: keep the
    // strongest evidence we have that the remote ref moved.
    push: record.outcome === "failed" && plan.push !== null ? plan.push : record,
    status: plan.pullRequest !== null ? plan.status : statusForPushOutcome(record.outcome, plan.status),
    updatedAt: at,
  };
  return appendPlanAudit(next, event, at, record.detail);
}

export function recordPullRequest(plan: PullRequestIntegrationPlan, record: PullRequestRecord, at: string): PullRequestIntegrationPlan {
  const next: PullRequestIntegrationPlan = { ...plan, pullRequest: record, status: "pr_open", updatedAt: at };
  return appendPlanAudit(
    next,
    record.origin === "created" ? "pr_created" : "pr_reconciled",
    at,
    `Pull Request #${record.number} (${record.isDraft ? "draft" : "ready"}) ${record.origin} at ${record.url}.`,
  );
}

/**
 * A create attempt whose outcome is genuinely unknown (network cut,
 * timeout, unparseable response). The next invocation MUST look up real
 * remote state before attempting anything else -- build spec Sec 10:
 * "ambiguous create failure -> lookup before retry".
 */
export function recordCreateAmbiguity(plan: PullRequestIntegrationPlan, at: string, detail: string): PullRequestIntegrationPlan {
  const next: PullRequestIntegrationPlan = {
    ...plan,
    // Never downgrade a plan that already knows its PR.
    status: plan.pullRequest !== null ? plan.status : "pr_ambiguous",
    updatedAt: at,
  };
  return appendPlanAudit(next, "pr_create_ambiguous", at, detail);
}

export function recordCreateFailure(plan: PullRequestIntegrationPlan, at: string, detail: string): PullRequestIntegrationPlan {
  return appendPlanAudit({ ...plan, updatedAt: at }, "pr_create_failed", at, detail);
}

export function recordReviewerRequest(plan: PullRequestIntegrationPlan, record: ReviewerRequestRecord, at: string): PullRequestIntegrationPlan {
  const next: PullRequestIntegrationPlan = { ...plan, reviewerRequest: record, updatedAt: at };
  return appendPlanAudit(
    next,
    record.outcome === "succeeded" ? "reviewers_requested" : "reviewers_failed",
    at,
    record.detail ?? `Reviewer request outcome: ${record.outcome}.`,
  );
}

export function recordBaseProtection(plan: PullRequestIntegrationPlan, record: BaseProtectionRecord, at: string): PullRequestIntegrationPlan {
  const next: PullRequestIntegrationPlan = { ...plan, baseProtection: record, updatedAt: at };
  return appendPlanAudit(next, "base_protection_recorded", at, `Base branch "${plan.baseBranch}" protection evidence: ${record.evidence}. ${record.detail}`);
}

/**
 * A gate refused. Only a plan that has caused no remote side effect may be
 * marked `blocked`: blocking a plan that already pushed or already has a PR
 * would hide a real side effect behind a terminal-looking status, and a
 * later invocation could then legitimately re-do it.
 */
export function markPlanBlocked(plan: PullRequestIntegrationPlan, at: string, detail: string): PullRequestIntegrationPlan {
  const next: PullRequestIntegrationPlan = {
    ...plan,
    status: hasRecordedRemoteSideEffect(plan) ? plan.status : "blocked",
    updatedAt: at,
  };
  return appendPlanAudit(next, "preflight_blocked", at, detail);
}

export function recordStaleness(plan: PullRequestIntegrationPlan, at: string, detail: string): PullRequestIntegrationPlan {
  const next: PullRequestIntegrationPlan = {
    ...plan,
    status: hasRecordedRemoteSideEffect(plan) ? plan.status : "blocked",
    updatedAt: at,
  };
  return appendPlanAudit(next, "stale_detected", at, detail);
}

/**
 * Build spec Sec 8/10 gate ordering, expressed once as data so `push`,
 * `create`, `status`, and `validate` all agree on what a plan is currently
 * permitted to do.
 */
export interface PlanCapability {
  canPush: boolean;
  canCreate: boolean;
  /** Set when an earlier attempt left an unknown remote outcome that must be reconciled first. */
  requiresReconciliation: boolean;
  reason: string;
}

export function evaluatePlanCapability(plan: PullRequestIntegrationPlan): PlanCapability {
  switch (plan.status) {
    case "prepared":
      return { canPush: true, canCreate: false, requiresReconciliation: false, reason: "Plan is prepared; the source branch must be pushed and verified before a Pull Request can be created." };
    case "push_verified":
      return { canPush: true, canCreate: true, requiresReconciliation: false, reason: "Source branch push is verified at the planned SHA." };
    case "push_ambiguous":
      return { canPush: false, canCreate: false, requiresReconciliation: true, reason: "A previous push attempt left an unknown remote outcome; re-read remote state before any further write." };
    case "pr_ambiguous":
      return { canPush: false, canCreate: false, requiresReconciliation: true, reason: "A previous create attempt left an unknown outcome; look up the Pull Request before retrying." };
    case "pr_open":
      return { canPush: false, canCreate: false, requiresReconciliation: false, reason: "A Pull Request already exists for this plan; it is never duplicated." };
    case "blocked":
      return { canPush: false, canCreate: false, requiresReconciliation: false, reason: "Plan was blocked before any remote write; prepare a new plan." };
  }
}
