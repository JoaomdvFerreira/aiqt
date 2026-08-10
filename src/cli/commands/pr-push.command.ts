import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { prFailure, resolveToken, missingPrCredentialActions, preflightFindingsToIssues, loadPlan } from "./pr-shared.js";
import { collectPrPreflightObservations, type CollectPrPreflightDeps } from "../../services/pr-preflight-service.js";
import { evaluatePrPreflight } from "../../workflow/pr-preflight.js";
import { evaluatePlanFreshness, describeStaleness, type PullRequestWriteBindingFacts } from "../../workflow/pr-integration-identity.js";
import { evaluatePlanCapability, markPlanBlocked, recordStaleness, recordPushOutcome, appendPlanAudit } from "../../workflow/pr-integration-lifecycle.js";
import { writePrIntegrationPlan } from "../../state/pr-integration-store.js";
import { performExactShaPush, type PerformPushDeps } from "../../services/pr-push-service.js";

/**
 * `aiqt pr push <integration-id>` (build spec Sec 6/8): the first remote
 * write M47 can perform, and it is always an explicit, separate operator
 * action -- nothing invokes it as a side effect of another workflow
 * completing.
 *
 * The order here is the safety property. Every gate runs against freshly
 * observed reality, not against what the plan recorded at prepare time:
 * capability -> freshness -> preflight -> push. Only then is a single
 * exact-SHA, non-force, single-ref push attempted, and its outcome is
 * decided by re-reading the remote rather than by the command's exit code.
 */

export interface PrPushOptions {
  tokenEnv?: string;
}

export interface PrPushDeps extends CollectPrPreflightDeps, PerformPushDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}

export async function runPrPush(_ctx: CommandContext, integrationId: string, options: PrPushOptions, deps: PrPushDeps = {}): Promise<CommandResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const loaded = loadPlan(integrationId);
  if (!loaded.ok) return loaded.result;
  const { home } = loaded;
  let plan = loaded.plan;

  // --- 1. Is this plan permitted to push at all? ---------------------------
  const capability = evaluatePlanCapability(plan);
  if (!capability.canPush) {
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Plan ${plan.id} cannot push: ${capability.reason}`,
      exitCode: ExitCode.WorkflowBlocked,
      affectedItems: [plan.id],
      blockingIssues: [
        {
          id: capability.requiresReconciliation ? "PR-PUSH-RECONCILIATION-REQUIRED" : "PR-PUSH-NOT-PERMITTED",
          severity: "high",
          area: "pr",
          message: capability.reason,
          suggestedAction: capability.requiresReconciliation
            ? `Run "aiqt pr status ${plan.id}" to reconcile the recorded outcome against real remote state before any further write.`
            : "Prepare a new plan if this integration should proceed.",
          agentCanFix: false,
        },
      ],
      data: { plan, capability },
    });
  }

  const { token, envName } = resolveToken(options.tokenEnv, deps.env);
  if (token === null) {
    return prFailure(
      `GitHub credentials are not available (environment variable "${envName}" is unset). Nothing was pushed.`,
      ExitCode.MissingDependency,
      "PR-PUSH-MISSING-CREDENTIALS",
      { suggestedAction: missingPrCredentialActions(envName).join(" ") },
    );
  }

  // --- 2. Re-observe reality --------------------------------------------
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

  // --- 3. Freshness: any changed write-relevant fact blocks --------------
  // The PR metadata digest is a plan-recorded fact rather than a
  // re-observable one (the body text is intentionally not persisted), so it
  // is carried through unchanged; every other fact comes from what was just
  // observed, not from the plan.
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
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Plan ${plan.id} is stale and cannot push: ${detail}`,
      exitCode: ExitCode.WorkflowBlocked,
      affectedItems: [plan.id],
      blockingIssues: [
        {
          id: "PR-PUSH-PLAN-STALE",
          severity: "high",
          area: "pr",
          message: `A write-relevant fact changed since this plan was prepared: ${detail}`,
          suggestedAction: "Prepare a new plan. A stale plan can never push or create -- the reviewed state and the current state no longer agree.",
          agentCanFix: false,
        },
      ],
      data: { plan, changedFacts: freshness.changedFacts },
    });
  }

  // --- 4. Full preflight against current reality -------------------------
  const preflight = evaluatePrPreflight(obs);
  if (!preflight.pushAllowed) {
    const pushBlocking = preflight.blocking.filter((f) => f.phase === "push" || f.phase === "both");
    plan = markPlanBlocked(plan, at, pushBlocking.map((f) => `${f.id}: ${f.message}`).join(" | "));
    writePrIntegrationPlan(home, plan);
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Push blocked for plan ${plan.id}: ${pushBlocking.map((f) => f.message).join(" ")}`,
      exitCode: ExitCode.WorkflowBlocked,
      affectedItems: [plan.id],
      blockingIssues: preflightFindingsToIssues(pushBlocking, "high"),
      warnings: preflightFindingsToIssues(preflight.warnings, "medium"),
      data: { plan, preflight },
    });
  }

  // --- 5. The write ------------------------------------------------------
  const outcome = performExactShaPush({ plan, remoteSourcePresenceBefore: obs.remoteSourcePresence, now: at }, deps);
  plan = recordPushOutcome(plan, outcome.record, at);
  writePrIntegrationPlan(home, plan);

  if (outcome.record.outcome === "verified") {
    return makeResult({
      status: "passed",
      action: "pr",
      summary: `Pushed exactly ${plan.sourceHeadSha} to ${plan.remoteRepositoryIdentity} refs/heads/${plan.sourceBranch} and verified it by re-reading the remote. No Pull Request exists yet.`,
      exitCode: ExitCode.Success,
      completedActions: ["Pushed the exact planned commit", "Verified the remote SHA after the write"],
      affectedItems: [plan.id],
      warnings: preflightFindingsToIssues(preflight.warnings, "low"),
      nextRecommendedCommand: `aiqt pr create ${plan.id}`,
      data: { plan, push: outcome.record },
    });
  }

  if (outcome.record.outcome === "ambiguous") {
    plan = appendPlanAudit(plan, "push_ambiguous", at, "Push outcome is unknown; reconciliation is required before any further write.");
    writePrIntegrationPlan(home, plan);
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Push outcome for plan ${plan.id} is UNKNOWN and was recorded as such: ${outcome.record.detail}`,
      exitCode: ExitCode.WorkflowBlocked,
      affectedItems: [plan.id],
      blockingIssues: [
        {
          id: "PR-PUSH-AMBIGUOUS",
          severity: "critical",
          area: "pr",
          message: outcome.record.detail,
          suggestedAction: `Run "aiqt pr status ${plan.id}" to reconcile against real remote state. AIQT will not retry the push on its own, because a retry could duplicate a side effect that may already have landed.`,
          agentCanFix: false,
        },
      ],
      data: { plan, push: outcome.record },
    });
  }

  return makeResult({
    status: "failed",
    action: "pr",
    summary: `Push failed for plan ${plan.id}: ${outcome.record.detail}`,
    exitCode: ExitCode.ExternalIntegrationError,
    affectedItems: [plan.id],
    blockingIssues: [
      {
        id: "PR-PUSH-FAILED",
        severity: "high",
        area: "pr",
        message: outcome.record.detail,
        suggestedAction: "The remote did not accept the update and does not hold the planned commit. Resolve the cause and prepare a new plan; AIQT has no force-push capability.",
        agentCanFix: false,
      },
    ],
    data: { plan, push: outcome.record },
  });
}
