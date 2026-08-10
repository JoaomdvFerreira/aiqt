import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { prFailure, resolveToken, missingPrCredentialActions, preflightFindingsToIssues, loadPlan } from "./pr-shared.js";
import { collectPrPreflightObservations, type CollectPrPreflightDeps } from "../../services/pr-preflight-service.js";
import { evaluatePrPreflight } from "../../workflow/pr-preflight.js";
import { evaluatePlanFreshness, describeStaleness, type PullRequestWriteBindingFacts } from "../../workflow/pr-integration-identity.js";
import {
  evaluatePlanCapability,
  markPlanBlocked,
  recordStaleness,
  recordPullRequest,
  recordCreateAmbiguity,
  recordCreateFailure,
  recordReviewerRequest,
} from "../../workflow/pr-integration-lifecycle.js";
import { writePrIntegrationPlan } from "../../state/pr-integration-store.js";
import { createOrReconcilePullRequest, requestPlanReviewers } from "../../services/pr-create-service.js";
import { realGithubPullRequestClient, type PullRequestProviderClient } from "../../services/github-pull-request-client.js";
import type { PullRequestIntegrationPlan } from "../../schema/pull-request-integration.schema.js";

/**
 * `aiqt pr create <integration-id>` (build spec Sec 6/10): creates or
 * reconciles exactly one Pull Request, and requests exactly the plan's
 * explicit reviewers.
 *
 * It is safe to run repeatedly. Every invocation asks the provider what
 * already exists for this head/base pair before creating anything, and a
 * plan that already knows its Pull Request never creates a second one --
 * it only completes what is still outstanding (currently: the reviewer
 * request). Nothing here approves, merges, labels, closes, or publishes.
 */

export interface PrCreateOptions {
  tokenEnv?: string;
}

export interface PrCreateDeps extends CollectPrPreflightDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  client?: PullRequestProviderClient;
}

function reviewerIssueSeverity(outcome: string): "high" | "medium" {
  return outcome === "failed" ? "high" : "medium";
}

export async function runPrCreate(_ctx: CommandContext, integrationId: string, options: PrCreateOptions, deps: PrCreateDeps = {}): Promise<CommandResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const loaded = loadPlan(integrationId);
  if (!loaded.ok) return loaded.result;
  const { home } = loaded;
  let plan = loaded.plan;

  const { token, envName } = resolveToken(options.tokenEnv, deps.env);
  if (token === null) {
    return prFailure(
      `GitHub credentials are not available (environment variable "${envName}" is unset). No Pull Request was created.`,
      ExitCode.MissingDependency,
      "PR-CREATE-MISSING-CREDENTIALS",
      { suggestedAction: missingPrCredentialActions(envName).join(" ") },
    );
  }

  const client = deps.client ?? realGithubPullRequestClient;
  const capability = evaluatePlanCapability(plan);

  // --- Already has a Pull Request: complete, never duplicate --------------
  if (plan.pullRequest !== null) {
    return await completeOutstandingWork(plan, home, client, token, now());
  }

  // A push whose outcome is unknown must be reconciled by `pr status`
  // before a Pull Request can be reasoned about at all.
  if (plan.status === "push_ambiguous") {
    return blockedResult(plan, "PR-CREATE-RECONCILIATION-REQUIRED", capability.reason, `Run "aiqt pr status ${plan.id}" to reconcile the recorded push outcome against real remote state.`);
  }
  // A previous create attempt left an unknown outcome. The create service
  // itself begins with a lookup, so this is allowed to proceed -- that
  // lookup is precisely the required reconciliation.
  if (!capability.canCreate && plan.status !== "pr_ambiguous") {
    return blockedResult(plan, "PR-CREATE-NOT-PERMITTED", capability.reason, "Push the source branch and verify it before creating a Pull Request.");
  }

  // --- Re-observe reality -------------------------------------------------
  const collected = await collectPrPreflightObservations(
    {
      repositoryRoot: plan.repositoryRoot,
      remoteName: plan.remoteName,
      baseBranch: plan.baseBranch,
      sourceBranch: plan.sourceBranch,
      plannedSha: plan.sourceHeadSha,
      reviewers: plan.reviewers,
      createMode: plan.createMode,
      requireProtectedBase: plan.policy.requireProtectedBase,
      token,
    },
    deps,
  );
  const obs = collected.observations;
  const at = now();

  const observedFacts: PullRequestWriteBindingFacts = {
    provider: plan.provider,
    repositoryRoot: plan.repositoryRoot,
    remoteName: plan.remoteName,
    remoteRepositoryIdentity: obs.providerIdentity ?? obs.remoteIdentity ?? "unresolved",
    baseBranch: plan.baseBranch,
    sourceBranch: obs.sourceBranch,
    sourceHeadSha: obs.sourceHeadSha ?? "unresolved",
    metadataDigest: plan.metadataDigest,
    reviewers: plan.reviewers,
    createMode: plan.createMode,
    policy: plan.policy,
  };
  const freshness = evaluatePlanFreshness(plan, observedFacts);
  if (!freshness.fresh) {
    const detail = describeStaleness(freshness.changedFacts);
    plan = recordStaleness(plan, at, detail);
    writePrIntegrationPlan(home, plan);
    return blockedResult(plan, "PR-CREATE-PLAN-STALE", `A write-relevant fact changed since this plan was prepared: ${detail}`, "Prepare a new plan.");
  }

  // --- Full preflight, including the base-protection policy ---------------
  const preflight = evaluatePrPreflight(obs);
  if (!preflight.createAllowed) {
    plan = markPlanBlocked(plan, at, preflight.blocking.map((f) => `${f.id}: ${f.message}`).join(" | "));
    writePrIntegrationPlan(home, plan);
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Pull Request creation blocked for plan ${plan.id}: ${preflight.blocking.map((f) => f.message).join(" ")}`,
      exitCode: ExitCode.WorkflowBlocked,
      affectedItems: [plan.id],
      blockingIssues: preflightFindingsToIssues(preflight.blocking, "high"),
      warnings: preflightFindingsToIssues(preflight.warnings, "medium"),
      data: { plan, preflight },
    });
  }

  // --- Create or reconcile ------------------------------------------------
  const outcome = await createOrReconcilePullRequest({ plan, remoteSourceSha: obs.remoteSourceSha, token, now: at }, client);

  if (outcome.kind === "ambiguous") {
    plan = recordCreateAmbiguity(plan, at, outcome.reason);
    writePrIntegrationPlan(home, plan);
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Pull Request state for plan ${plan.id} is UNKNOWN and was recorded as such: ${outcome.reason}`,
      exitCode: ExitCode.WorkflowBlocked,
      affectedItems: [plan.id],
      blockingIssues: [
        {
          id: "PR-CREATE-AMBIGUOUS",
          severity: "critical",
          area: "pr",
          message: outcome.reason,
          suggestedAction: `Run "aiqt pr status ${plan.id}" once the provider is reachable. Re-running create is safe -- it always looks up before creating -- but nothing will be created while the lookup itself fails.`,
          agentCanFix: false,
        },
      ],
      data: { plan },
    });
  }

  if (outcome.kind === "conflict") {
    plan = recordCreateFailure(plan, at, outcome.reason);
    writePrIntegrationPlan(home, plan);
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Pull Request creation blocked by a conflicting existing Pull Request: ${outcome.reason}`,
      exitCode: ExitCode.WorkflowBlocked,
      affectedItems: [plan.id],
      blockingIssues: [
        {
          id: "PR-CREATE-CONFLICTING-PULL-REQUEST",
          severity: "high",
          area: "pr",
          message: outcome.reason,
          suggestedAction: "Resolve the existing Pull Request(s) yourself, then prepare a new plan. AIQT never closes, edits, or supersedes a Pull Request it did not create.",
          agentCanFix: false,
        },
      ],
      data: { plan, existing: outcome.existing },
    });
  }

  if (outcome.kind === "failed") {
    plan = recordCreateFailure(plan, at, outcome.reason);
    writePrIntegrationPlan(home, plan);
    return makeResult({
      status: "failed",
      action: "pr",
      summary: `Pull Request creation failed for plan ${plan.id}: ${outcome.reason}`,
      exitCode: ExitCode.ExternalIntegrationError,
      affectedItems: [plan.id],
      blockingIssues: [{ id: "PR-CREATE-FAILED", severity: "high", area: "pr", message: outcome.reason, agentCanFix: false }],
      data: { plan },
    });
  }

  plan = recordPullRequest(plan, outcome.record, at);
  writePrIntegrationPlan(home, plan);

  // --- Reviewers: a separate side effect, on the same Pull Request --------
  const reviewerRecord = await requestPlanReviewers({ plan, pullNumber: outcome.record.number, token, now: at }, client);
  plan = recordReviewerRequest(plan, reviewerRecord, at);
  writePrIntegrationPlan(home, plan);

  const reviewerFailed = reviewerRecord.outcome === "failed" || reviewerRecord.outcome === "partial";
  const verb = outcome.record.origin === "created" ? "Created" : "Reconciled to existing";
  return makeResult({
    status: reviewerFailed ? "warning" : "passed",
    action: "pr",
    summary:
      `${verb} ${outcome.record.isDraft ? "draft " : ""}Pull Request #${outcome.record.number} (${outcome.record.url}) for ${plan.remoteRepositoryIdentity} ${plan.sourceBranch}@${plan.sourceHeadSha.slice(0, 12)} -> ${plan.baseBranch}.` +
      ` ${reviewerSummary(reviewerRecord.outcome, reviewerRecord.detail)} Nothing has been approved, merged, deployed, or released.`,
    exitCode: ExitCode.Success,
    completedActions: [outcome.record.origin === "created" ? "Created one Pull Request" : "Reconciled to the existing Pull Request", `Reviewer request: ${reviewerRecord.outcome}`],
    affectedItems: [plan.id, `#${outcome.record.number}`],
    warnings: reviewerFailed
      ? [
          {
            id: "PR-CREATE-REVIEWERS-INCOMPLETE",
            severity: reviewerIssueSeverity(reviewerRecord.outcome),
            area: "pr",
            message: reviewerRecord.detail ?? "The reviewer request did not complete.",
            suggestedAction: `Re-run "aiqt pr create ${plan.id}" to retry only the reviewer request -- it will never create a second Pull Request.`,
            agentCanFix: false,
          },
        ]
      : [],
    nextRecommendedCommand: `aiqt pr status ${plan.id}`,
    data: { plan, pullRequest: outcome.record, reviewerRequest: reviewerRecord },
  });
}

function reviewerSummary(outcome: string, detail: string | null): string {
  if (outcome === "not_requested") return "No reviewers were requested.";
  if (outcome === "succeeded") return detail ?? "Reviewers requested.";
  return `Reviewer request ${outcome}: ${detail ?? "no detail"}.`;
}

function blockedResult(plan: PullRequestIntegrationPlan, id: string, message: string, suggestedAction: string): CommandResult {
  return makeResult({
    status: "blocked",
    action: "pr",
    summary: `Plan ${plan.id} cannot create a Pull Request: ${message}`,
    exitCode: ExitCode.WorkflowBlocked,
    affectedItems: [plan.id],
    blockingIssues: [{ id, severity: "high", area: "pr", message, suggestedAction, agentCanFix: false }],
    data: { plan },
  });
}

/**
 * The plan already has a Pull Request. This path exists so a retry after a
 * reviewer failure completes the outstanding work against the SAME Pull
 * Request -- it is the reason a partial side effect is recoverable without
 * ever risking a duplicate.
 */
async function completeOutstandingWork(
  plan: PullRequestIntegrationPlan,
  home: string,
  client: PullRequestProviderClient,
  token: string,
  at: string,
): Promise<CommandResult> {
  const pr = plan.pullRequest!;
  const reviewersOutstanding =
    plan.reviewers.length > 0 && (plan.reviewerRequest === null || plan.reviewerRequest.outcome === "failed" || plan.reviewerRequest.outcome === "partial");

  if (!reviewersOutstanding) {
    return makeResult({
      status: "passed",
      action: "pr",
      summary: `Pull Request #${pr.number} already exists for plan ${plan.id} (${pr.url}); nothing further to do. AIQT never creates a second Pull Request for a plan.`,
      exitCode: ExitCode.Success,
      affectedItems: [plan.id, `#${pr.number}`],
      nextRecommendedCommand: `aiqt pr status ${plan.id}`,
      data: { plan, pullRequest: pr, reviewerRequest: plan.reviewerRequest },
    });
  }

  const reviewerRecord = await requestPlanReviewers({ plan, pullNumber: pr.number, token, now: at }, client);
  const updated = recordReviewerRequest(plan, reviewerRecord, at);
  writePrIntegrationPlan(home, updated);

  const stillIncomplete = reviewerRecord.outcome === "failed" || reviewerRecord.outcome === "partial";
  return makeResult({
    status: stillIncomplete ? "warning" : "passed",
    action: "pr",
    summary: `Pull Request #${pr.number} already existed; retried only the reviewer request. ${reviewerSummary(reviewerRecord.outcome, reviewerRecord.detail)}`,
    exitCode: ExitCode.Success,
    completedActions: [`Reviewer request: ${reviewerRecord.outcome}`],
    affectedItems: [updated.id, `#${pr.number}`],
    warnings: stillIncomplete
      ? [
          {
            id: "PR-CREATE-REVIEWERS-INCOMPLETE",
            severity: reviewerIssueSeverity(reviewerRecord.outcome),
            area: "pr",
            message: reviewerRecord.detail ?? "The reviewer request did not complete.",
            suggestedAction: "Retry is always safe -- an existing Pull Request is never duplicated.",
            agentCanFix: false,
          },
        ]
      : [],
    nextRecommendedCommand: `aiqt pr status ${updated.id}`,
    data: { plan: updated, pullRequest: pr, reviewerRequest: reviewerRecord },
  });
}
