import type { PullRequestIntegrationPlan, PullRequestRecord, ReviewerRequestRecord } from "../schema/pull-request-integration.schema.js";
import type { GithubExistingPullRequest, PullRequestProviderClient } from "./github-pull-request-client.js";
import { parseOwnerRepo } from "../workflow/release-draft-policy.js";

/**
 * M47-WU04 (build spec Sec 10): creating or reconciling exactly one Pull
 * Request, and requesting exactly the plan's explicit reviewers.
 *
 * The controlling rule is that a lookup always precedes a create, and a
 * create is never retried blind. Duplicate PRs are the characteristic
 * failure of naive integrations: a timeout on POST /pulls tells you
 * nothing about whether the PR exists, so retrying produces two. Here,
 * every path -- first attempt, retry after an ambiguous failure, restart
 * after a crash -- begins by asking the provider what actually exists for
 * this exact head/base pair, and a matching open PR is adopted rather than
 * duplicated.
 *
 * Reviewer assignment is a separate side effect from creation, so
 * "PR created, reviewers not assigned" is a typed partial state that a
 * later invocation completes WITHOUT creating a second PR.
 */

export type CreateOutcome =
  | { kind: "reconciled"; record: PullRequestRecord }
  | { kind: "created"; record: PullRequestRecord }
  | { kind: "conflict"; reason: string; existing: GithubExistingPullRequest[] }
  | { kind: "ambiguous"; reason: string }
  | { kind: "failed"; reason: string };

export interface CreateOrReconcileInput {
  plan: PullRequestIntegrationPlan;
  /** The remote source SHA observed immediately before this call. Create requires exact equality with the plan's bound SHA. */
  remoteSourceSha: string | null;
  token: string;
  now: string;
}

function toRecord(pr: GithubExistingPullRequest, origin: PullRequestRecord["origin"], at: string): PullRequestRecord {
  return {
    number: pr.number,
    url: pr.htmlUrl,
    state: pr.merged ? "merged" : pr.state,
    isDraft: pr.isDraft,
    headSha: pr.headSha,
    baseBranch: pr.baseRef,
    sourceBranch: pr.headRef,
    origin,
    recordedAt: at,
  };
}

export async function createOrReconcilePullRequest(input: CreateOrReconcileInput, client: PullRequestProviderClient): Promise<CreateOutcome> {
  const { plan, now, token } = input;

  const ownerRepo = parseOwnerRepo(plan.remoteRepositoryIdentity);
  if (ownerRepo === null) {
    return { kind: "failed", reason: `The plan's repository identity "${plan.remoteRepositoryIdentity}" is not an "owner/repo" GitHub identity.` };
  }
  const { owner, repo } = ownerRepo;

  // --- Exact provenance: the PR must describe the reviewed commit --------
  if (input.remoteSourceSha === null) {
    return { kind: "failed", reason: `Remote branch "${plan.sourceBranch}" does not hold a readable commit, so a Pull Request cannot be bound to the planned commit.` };
  }
  if (input.remoteSourceSha.toLowerCase() !== plan.sourceHeadSha.toLowerCase()) {
    return {
      kind: "failed",
      reason: `Remote "${plan.sourceBranch}" is at ${input.remoteSourceSha}, not the planned ${plan.sourceHeadSha}. A Pull Request is only ever opened for the exact commit this plan bound.`,
    };
  }

  // --- Lookup before create, on every path -------------------------------
  const existing = await client.findOpenPullRequests(owner, repo, plan.sourceBranch, plan.baseBranch, token);
  if (!existing.ok) {
    // We do not know what exists. Creating now could duplicate; this is
    // reported as ambiguous so the operator reconciles rather than retries.
    return { kind: "ambiguous", reason: `Could not determine whether a Pull Request already exists: ${existing.message}` };
  }

  const openMatching = existing.value.filter((pr) => pr.state === "open" && !pr.merged);
  if (openMatching.length > 1) {
    return {
      kind: "conflict",
      reason: `${openMatching.length} open Pull Requests already exist for ${plan.sourceBranch} -> ${plan.baseBranch} (#${openMatching.map((p) => p.number).join(", #")}). AIQT will not guess which one this plan owns.`,
      existing: openMatching,
    };
  }

  if (openMatching.length === 1) {
    const pr = openMatching[0]!;
    // Provenance check: an existing PR is only adopted when it genuinely
    // describes this plan's work. A PR on the same branch pair whose head
    // is a different commit is someone else's (or an older) integration.
    if (pr.headSha !== null && pr.headSha.toLowerCase() !== plan.sourceHeadSha.toLowerCase()) {
      return {
        kind: "conflict",
        reason: `Open Pull Request #${pr.number} for ${plan.sourceBranch} -> ${plan.baseBranch} is at head ${pr.headSha}, not this plan's ${plan.sourceHeadSha}. Prepare a new plan rather than adopting a Pull Request for a different commit.`,
        existing: [pr],
      };
    }
    return { kind: "reconciled", record: toRecord(pr, "reconciled", now) };
  }

  // --- Create ------------------------------------------------------------
  const created = await client.createPullRequest(
    owner,
    repo,
    {
      title: plan.title,
      body: plan.body,
      headBranch: plan.sourceBranch,
      baseBranch: plan.baseBranch,
      draft: plan.createMode === "draft",
    },
    token,
  );

  if (created.ok) {
    return { kind: "created", record: toRecord(created.value, "created", now) };
  }

  // A create that failed with no HTTP status never reached a decision point
  // on GitHub's side in a way we can distinguish from "it was accepted and
  // the response was lost". A create that failed WITH a status may still
  // have succeeded if the status came from a proxy or the response was
  // unparseable. Either way the answer is the same: look up, do not retry.
  const lookupAfter = await client.findOpenPullRequests(owner, repo, plan.sourceBranch, plan.baseBranch, token);
  if (lookupAfter.ok) {
    const nowOpen = lookupAfter.value.filter((pr) => pr.state === "open" && !pr.merged);
    if (nowOpen.length === 1) {
      // The create did land despite the reported error.
      return { kind: "reconciled", record: toRecord(nowOpen[0]!, "created", now) };
    }
    if (nowOpen.length === 0) {
      return { kind: "failed", reason: `Pull Request creation failed and no Pull Request exists for ${plan.sourceBranch} -> ${plan.baseBranch}: ${created.message}` };
    }
    return { kind: "conflict", reason: `Pull Request creation reported "${created.message}", and ${nowOpen.length} open Pull Requests now exist for this branch pair.`, existing: nowOpen };
  }

  return {
    kind: "ambiguous",
    reason: `Pull Request creation failed (${created.message}) and the follow-up lookup also failed (${lookupAfter.message}), so whether a Pull Request now exists is unknown.`,
  };
}

export interface RequestReviewersInput {
  plan: PullRequestIntegrationPlan;
  pullNumber: number;
  token: string;
  now: string;
}

/**
 * Build spec Sec 10: explicit reviewers only. A failure here never
 * invalidates the Pull Request that already exists -- it produces a typed
 * partial record that a later `pr create` completes against the SAME PR.
 */
export async function requestPlanReviewers(input: RequestReviewersInput, client: PullRequestProviderClient): Promise<ReviewerRequestRecord> {
  const { plan, now } = input;
  if (plan.reviewers.length === 0) {
    return { attemptedAt: null, outcome: "not_requested", requested: [], confirmed: [], detail: "No reviewers were requested by this plan." };
  }

  const ownerRepo = parseOwnerRepo(plan.remoteRepositoryIdentity);
  if (ownerRepo === null) {
    return { attemptedAt: now, outcome: "failed", requested: [...plan.reviewers], confirmed: [], detail: "The plan's repository identity is not an owner/repo GitHub identity." };
  }

  const result = await client.requestReviewers(ownerRepo.owner, ownerRepo.repo, input.pullNumber, plan.reviewers, input.token);
  if (!result.ok) {
    return {
      attemptedAt: now,
      outcome: "failed",
      requested: [...plan.reviewers],
      confirmed: [],
      detail: `Reviewer request failed: ${result.message}. The Pull Request itself is unaffected and must not be recreated.`,
    };
  }

  const confirmedLower = new Set(result.value.map((r) => r.toLowerCase()));
  const missing = plan.reviewers.filter((r) => !confirmedLower.has(r.toLowerCase()));
  if (missing.length === 0) {
    return { attemptedAt: now, outcome: "succeeded", requested: [...plan.reviewers], confirmed: result.value, detail: `Requested ${plan.reviewers.length} reviewer(s).` };
  }
  return {
    attemptedAt: now,
    outcome: "partial",
    requested: [...plan.reviewers],
    confirmed: result.value,
    detail: `GitHub confirmed ${result.value.length} of ${plan.reviewers.length} requested reviewer(s); not confirmed: ${missing.join(", ")}.`,
  };
}
