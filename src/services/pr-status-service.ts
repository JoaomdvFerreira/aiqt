import type { PullRequestIntegrationPlan } from "../schema/pull-request-integration.schema.js";
import type { PullRequestProviderClient, GithubExistingPullRequest } from "./github-pull-request-client.js";
import { recordPushOutcome, recordPullRequest, clearCreateAmbiguity } from "../workflow/pr-integration-lifecycle.js";
import { parseOwnerRepo } from "../workflow/release-draft-policy.js";

/**
 * M47-WU05 (build spec Sec 6/10/13): reconciliation. `pr status` is
 * read-only with respect to the REMOTE -- it issues only lookups -- but it
 * is the one operation that can turn a recorded `ambiguous` outcome into a
 * definite one by comparing what the plan recorded against what the remote
 * actually holds.
 *
 * This is what makes an interrupted integration resumable without ever
 * risking a duplicate: the push and create commands refuse to act while an
 * outcome is unknown, and this is the only path that resolves that
 * unknown, from real remote evidence rather than from assumption.
 *
 * Reconciliation only ever moves a plan toward MORE certainty. It can
 * confirm a push landed, record that it did not, or adopt a Pull Request
 * that already exists -- it never clears a recorded side effect, and it
 * never creates one.
 */

export interface ReconciliationInput {
  plan: PullRequestIntegrationPlan;
  /** Remote source-branch SHA as just observed. Null = the branch is absent; `remoteReadable` false = it could not be read at all. */
  remoteSourceSha: string | null;
  remoteReadable: boolean;
  token: string;
  now: string;
}

export interface ReconciliationFinding {
  id: string;
  message: string;
  severity: "high" | "medium" | "low";
  suggestedAction?: string;
}

export interface ReconciliationResult {
  plan: PullRequestIntegrationPlan;
  findings: ReconciliationFinding[];
  changed: boolean;
  /** The provider's current view of this plan's Pull Request, when one could be read. */
  observedPullRequest: GithubExistingPullRequest | null;
  /** Set when a provider lookup failed, so the caller can report the external error honestly. Already redacted. */
  providerError: string | null;
}

export async function reconcilePlan(input: ReconciliationInput, client: PullRequestProviderClient): Promise<ReconciliationResult> {
  const { now, token } = input;
  let plan = input.plan;
  const findings: ReconciliationFinding[] = [];
  let changed = false;
  let providerError: string | null = null;
  let observedPullRequest: GithubExistingPullRequest | null = null;

  // --- 1. Resolve an unknown push outcome from real remote state ---------
  if (plan.status === "push_ambiguous") {
    if (!input.remoteReadable) {
      findings.push({
        id: "PR-STATUS-PUSH-STILL-UNKNOWN",
        severity: "high",
        message: `The remote branch "${plan.sourceBranch}" still cannot be read, so the earlier push outcome remains unknown.`,
        suggestedAction: "Restore access to the remote and re-run status. No write will be attempted until the outcome is definite.",
      });
    } else if (input.remoteSourceSha !== null && input.remoteSourceSha.toLowerCase() === plan.sourceHeadSha.toLowerCase()) {
      plan = recordPushOutcome(
        plan,
        {
          attemptedAt: plan.push?.attemptedAt ?? now,
          outcome: "verified",
          plannedSha: plan.sourceHeadSha,
          remoteShaAfter: input.remoteSourceSha,
          remoteBranchPresenceBefore: plan.push?.remoteBranchPresenceBefore ?? "unverifiable",
          detail: `Reconciled: the remote branch holds exactly the planned commit, so the earlier push did land.`,
        },
        now,
      );
      changed = true;
      findings.push({ id: "PR-STATUS-PUSH-RECONCILED-VERIFIED", severity: "low", message: "The earlier ambiguous push is confirmed to have landed at the planned commit." });
    } else {
      plan = recordPushOutcome(
        plan,
        {
          attemptedAt: plan.push?.attemptedAt ?? now,
          outcome: "failed",
          plannedSha: plan.sourceHeadSha,
          remoteShaAfter: input.remoteSourceSha,
          remoteBranchPresenceBefore: plan.push?.remoteBranchPresenceBefore ?? "unverifiable",
          detail: `Reconciled: the remote branch holds ${input.remoteSourceSha ?? "no commit"}, not the planned ${plan.sourceHeadSha}, so the earlier push did not land.`,
        },
        now,
      );
      changed = true;
      findings.push({
        id: "PR-STATUS-PUSH-RECONCILED-FAILED",
        severity: "medium",
        message: "The earlier ambiguous push did not land; the remote does not hold the planned commit.",
        suggestedAction: `Re-run "aiqt pr push ${plan.id}" if the plan is still fresh, or prepare a new plan.`,
      });
    }
  }

  const ownerRepo = parseOwnerRepo(plan.remoteRepositoryIdentity);
  if (ownerRepo === null) {
    findings.push({ id: "PR-STATUS-IDENTITY-UNPARSEABLE", severity: "high", message: `The plan's repository identity "${plan.remoteRepositoryIdentity}" is not an "owner/repo" GitHub identity.` });
    return { plan, findings, changed, observedPullRequest, providerError };
  }
  const { owner, repo } = ownerRepo;

  // --- 2. Refresh a Pull Request the plan already knows about ------------
  if (plan.pullRequest !== null) {
    const refreshed = await client.getPullRequest(owner, repo, plan.pullRequest.number, token);
    if (!refreshed.ok) {
      providerError = refreshed.message;
      findings.push({ id: "PR-STATUS-PULL-REQUEST-UNREADABLE", severity: "medium", message: `Pull Request #${plan.pullRequest.number} could not be read: ${refreshed.message}` });
    } else if (refreshed.value === null) {
      findings.push({
        id: "PR-STATUS-PULL-REQUEST-MISSING",
        severity: "high",
        message: `Pull Request #${plan.pullRequest.number} is recorded for this plan but the provider no longer reports it.`,
        suggestedAction: "Investigate before any further action. The recorded side effect is deliberately not cleared -- AIQT does not erase evidence that a Pull Request once existed.",
      });
    } else {
      observedPullRequest = refreshed.value;
      if (refreshed.value.merged) {
        findings.push({
          id: "PR-STATUS-PULL-REQUEST-MERGED",
          severity: "low",
          message: `Pull Request #${refreshed.value.number} has been merged by a human. AIQT never merges, and does nothing further with a merged Pull Request.`,
        });
      } else if (refreshed.value.state === "closed") {
        findings.push({ id: "PR-STATUS-PULL-REQUEST-CLOSED", severity: "medium", message: `Pull Request #${refreshed.value.number} is closed.` });
      }
    }
    return { plan, findings, changed, observedPullRequest, providerError };
  }

  // --- 3. Resolve an unknown create outcome ------------------------------
  if (plan.status === "pr_ambiguous" || plan.status === "push_verified") {
    const lookup = await client.findOpenPullRequests(owner, repo, plan.sourceBranch, plan.baseBranch, token);
    if (!lookup.ok) {
      providerError = lookup.message;
      findings.push({
        id: plan.status === "pr_ambiguous" ? "PR-STATUS-CREATE-STILL-UNKNOWN" : "PR-STATUS-LOOKUP-FAILED",
        severity: plan.status === "pr_ambiguous" ? "high" : "medium",
        message: `Open Pull Requests could not be listed: ${lookup.message}`,
        suggestedAction: "Re-run status once the provider is reachable.",
      });
      return { plan, findings, changed, observedPullRequest, providerError };
    }

    const open = lookup.value.filter((pr) => pr.state === "open" && !pr.merged);
    const matching = open.filter((pr) => pr.headSha === null || pr.headSha.toLowerCase() === plan.sourceHeadSha.toLowerCase());

    if (open.length > 1) {
      findings.push({
        id: "PR-STATUS-MULTIPLE-PULL-REQUESTS",
        severity: "high",
        message: `${open.length} open Pull Requests exist for ${plan.sourceBranch} -> ${plan.baseBranch} (#${open.map((p) => p.number).join(", #")}). AIQT will not adopt one by guessing.`,
        suggestedAction: "Resolve the duplicates yourself, then prepare a new plan.",
      });
    } else if (matching.length === 1) {
      const pr = matching[0]!;
      observedPullRequest = pr;
      plan = recordPullRequest(
        plan,
        {
          number: pr.number,
          url: pr.htmlUrl,
          state: pr.merged ? "merged" : pr.state,
          isDraft: pr.isDraft,
          headSha: pr.headSha,
          baseBranch: pr.baseRef,
          sourceBranch: pr.headRef,
          origin: "reconciled",
          recordedAt: now,
        },
        now,
      );
      changed = true;
      findings.push({
        id: "PR-STATUS-PULL-REQUEST-RECONCILED",
        severity: "low",
        message: `Adopted the existing open Pull Request #${pr.number} for this plan; no second Pull Request will ever be created for it.`,
      });
    } else if (open.length === 1) {
      findings.push({
        id: "PR-STATUS-PULL-REQUEST-PROVENANCE-CONFLICT",
        severity: "high",
        message: `Open Pull Request #${open[0]!.number} exists for ${plan.sourceBranch} -> ${plan.baseBranch} but is at head ${open[0]!.headSha}, not this plan's ${plan.sourceHeadSha}.`,
        suggestedAction: "Prepare a new plan rather than adopting a Pull Request for a different commit.",
      });
    } else if (plan.status === "pr_ambiguous") {
      plan = clearCreateAmbiguity(plan, now, "Reconciled: no open Pull Request exists for this branch pair, so the earlier ambiguous create did not land.");
      changed = true;
      findings.push({
        id: "PR-STATUS-CREATE-RECONCILED-ABSENT",
        severity: "medium",
        message: "The earlier ambiguous Pull Request creation did not land; no open Pull Request exists for this branch pair.",
        suggestedAction: `Re-run "aiqt pr create ${plan.id}" -- it always looks up before creating, so this cannot duplicate.`,
      });
    }
  }

  return { plan, findings, changed, observedPullRequest, providerError };
}
