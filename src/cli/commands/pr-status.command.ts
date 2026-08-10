import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { Issue } from "../../core/output/issue.js";
import { prFailure, resolveToken, missingPrCredentialActions, preflightFindingsToIssues, loadPlan } from "./pr-shared.js";
import { collectPrPreflightObservations, type CollectPrPreflightDeps } from "../../services/pr-preflight-service.js";
import { evaluatePrPreflight } from "../../workflow/pr-preflight.js";
import { evaluatePlanFreshness, describeStaleness, type PullRequestWriteBindingFacts } from "../../workflow/pr-integration-identity.js";
import { evaluatePlanCapability } from "../../workflow/pr-integration-lifecycle.js";
import { writePrIntegrationPlan } from "../../state/pr-integration-store.js";
import { reconcilePlan, type ReconciliationFinding } from "../../services/pr-status-service.js";
import { realGithubPullRequestClient, type PullRequestProviderClient } from "../../services/github-pull-request-client.js";

/**
 * `aiqt pr status` and `aiqt pr validate` (build spec Sec 6/11/13).
 *
 * Both are read-only with respect to the remote: they issue lookups only,
 * and neither can approve, label, merge, close, deploy, or publish
 * anything. `pr status` additionally reconciles the plan record against
 * what the remote actually holds, which is the operation that makes an
 * interrupted integration resumable -- push and create both refuse to act
 * while an outcome is unknown, and this is the only path that resolves
 * that unknown, from evidence rather than assumption. That reconciliation
 * writes the local plan file; it never writes to the remote.
 *
 * `pr validate` writes nothing at all. It re-runs every gate and reports a
 * deterministic verdict, so an operator can ask "would this proceed?"
 * without any side effect whatsoever.
 */

export interface PrStatusOptions {
  tokenEnv?: string;
}

export interface PrStatusDeps extends CollectPrPreflightDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  client?: PullRequestProviderClient;
}

function reconciliationIssues(findings: readonly ReconciliationFinding[]): { blocking: Issue[]; warnings: Issue[] } {
  const blocking: Issue[] = [];
  const warnings: Issue[] = [];
  for (const f of findings) {
    const issue: Issue = { id: f.id, severity: f.severity, area: "pr", message: f.message, agentCanFix: false, ...(f.suggestedAction ? { suggestedAction: f.suggestedAction } : {}) };
    if (f.severity === "high") blocking.push(issue);
    else warnings.push(issue);
  }
  return { blocking, warnings };
}

export async function runPrStatus(_ctx: CommandContext, integrationId: string, options: PrStatusOptions, deps: PrStatusDeps = {}): Promise<CommandResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const loaded = loadPlan(integrationId);
  if (!loaded.ok) return loaded.result;
  const { home } = loaded;
  let plan = loaded.plan;

  const { token, envName } = resolveToken(options.tokenEnv, deps.env);
  if (token === null) {
    return prFailure(
      `GitHub credentials are not available (environment variable "${envName}" is unset), so the plan cannot be reconciled against real remote state.`,
      ExitCode.MissingDependency,
      "PR-STATUS-MISSING-CREDENTIALS",
      { suggestedAction: missingPrCredentialActions(envName).join(" ") },
    );
  }

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

  const reconciliation = await reconcilePlan(
    {
      plan,
      remoteSourceSha: obs.remoteSourceSha,
      remoteReadable: obs.remoteSourcePresence !== "unverifiable",
      token,
      now: at,
    },
    deps.client ?? realGithubPullRequestClient,
  );
  plan = reconciliation.plan;
  if (reconciliation.changed) {
    writePrIntegrationPlan(home, plan);
  }

  const capability = evaluatePlanCapability(plan);
  const { blocking, warnings } = reconciliationIssues(reconciliation.findings);
  const hasBlocking = blocking.length > 0;

  return makeResult({
    status: hasBlocking ? "warning" : "passed",
    action: "pr",
    summary:
      `Plan ${plan.id} [${plan.status}]: ${plan.remoteRepositoryIdentity} ${plan.sourceBranch}@${plan.sourceHeadSha.slice(0, 12)} -> ${plan.baseBranch}. ` +
      `Push: ${plan.push?.outcome ?? "not attempted"}. Pull Request: ${plan.pullRequest === null ? "none" : `#${plan.pullRequest.number} (${plan.pullRequest.isDraft ? "draft" : "ready"})`}. ` +
      `Reviewers: ${plan.reviewerRequest?.outcome ?? "not requested"}. ${capability.reason}`,
    // Status is diagnostic, not a gate: an unresolved condition is reported
    // as an issue, but the command itself succeeds so an operator can always
    // inspect a broken integration.
    exitCode: ExitCode.Success,
    affectedItems: [plan.id, ...(plan.pullRequest ? [`#${plan.pullRequest.number}`] : [])],
    completedActions: reconciliation.changed ? ["Reconciled the plan against real remote state"] : [],
    blockingIssues: blocking,
    warnings,
    data: {
      plan,
      capability,
      reconciled: reconciliation.changed,
      observedPullRequest: reconciliation.observedPullRequest,
      providerError: reconciliation.providerError,
      remote: {
        sourcePresence: obs.remoteSourcePresence,
        sourceSha: obs.remoteSourceSha,
        basePresence: obs.remoteBasePresence,
        baseProtection: obs.baseProtection,
      },
    },
  });
}

/**
 * `aiqt pr validate <integration-id>`: re-runs freshness, the full
 * preflight, the base-protection policy, and the plan's own capability,
 * and reports a deterministic verdict. It performs no remote write and no
 * local write -- not even to the plan file -- so it is always safe to run.
 */
export async function runPrValidate(_ctx: CommandContext, integrationId: string, options: PrStatusOptions, deps: PrStatusDeps = {}): Promise<CommandResult> {
  const loaded = loadPlan(integrationId);
  if (!loaded.ok) return loaded.result;
  const plan = loaded.plan;

  const { token, envName } = resolveToken(options.tokenEnv, deps.env);
  if (token === null) {
    return prFailure(
      `GitHub credentials are not available (environment variable "${envName}" is unset), so the plan cannot be validated against real remote state.`,
      ExitCode.MissingDependency,
      "PR-VALIDATE-MISSING-CREDENTIALS",
      { suggestedAction: missingPrCredentialActions(envName).join(" ") },
    );
  }

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
  const preflight = evaluatePrPreflight(obs);
  const capability = evaluatePlanCapability(plan);

  const blocking: Issue[] = [...preflightFindingsToIssues(preflight.blocking, "high")];
  if (!freshness.fresh) {
    blocking.unshift({
      id: "PR-VALIDATE-PLAN-STALE",
      severity: "high",
      area: "pr",
      message: `A write-relevant fact changed since this plan was prepared: ${describeStaleness(freshness.changedFacts)}`,
      suggestedAction: "Prepare a new plan.",
      agentCanFix: false,
    });
  }

  const wouldPush = freshness.fresh && preflight.pushAllowed && capability.canPush;
  const wouldCreate = freshness.fresh && preflight.createAllowed && (capability.canCreate || plan.status === "pr_ambiguous");
  const ok = blocking.length === 0;

  return makeResult({
    status: ok ? "passed" : "blocked",
    action: "pr",
    summary: ok
      ? `Plan ${plan.id} validates: push ${wouldPush ? "permitted" : "not permitted"}, create ${wouldCreate ? "permitted" : "not permitted"}. Base protection evidence: ${obs.baseProtection}. Nothing was written.`
      : `Plan ${plan.id} does not validate: ${blocking.map((i) => i.message).join(" ")}`,
    exitCode: ok ? ExitCode.Success : ExitCode.WorkflowBlocked,
    affectedItems: [plan.id],
    blockingIssues: blocking,
    warnings: preflightFindingsToIssues(preflight.warnings, "medium"),
    data: {
      plan,
      capability,
      fresh: freshness.fresh,
      changedFacts: freshness.fresh ? [] : freshness.changedFacts,
      preflight,
      wouldPush,
      wouldCreate,
      baseProtection: obs.baseProtection,
      providerError: collected.providerError,
    },
  });
}
