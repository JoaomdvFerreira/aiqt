import { resolve } from "node:path";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { prFailure, loadPrBody, validateTitle, resolveToken, missingPrCredentialActions, preflightFindingsToIssues, loadPlan } from "./pr-shared.js";
import { collectPrPreflightObservations, type CollectPrPreflightDeps } from "../../services/pr-preflight-service.js";
import { evaluatePrPreflight } from "../../workflow/pr-preflight.js";
import { computePrMetadataDigest, generatePrIntegrationId, normalizeReviewers, type PullRequestWriteBindingFacts } from "../../workflow/pr-integration-identity.js";
import { createIntegrationPlan, recordBaseProtection, markPlanBlocked, evaluatePlanCapability } from "../../workflow/pr-integration-lifecycle.js";
import { writePrIntegrationPlan } from "../../state/pr-integration-store.js";
import { resolvePrIntegrationHome, resolvePrIntegrationFilePath } from "../../state/pr-integration-home.js";
import type { PullRequestPortfolioRef } from "../../schema/pull-request-integration.schema.js";

/**
 * `aiqt pr prepare` (build spec Sec 6): READ-ONLY. It binds an exact
 * repository, remote, base, source, and commit SHA into a persisted
 * integration plan and runs the full read-only preflight -- it never
 * pushes, never creates a Pull Request, and never mutates the target
 * repository in any way.
 *
 * A plan is written even when preflight blocks: the blocked plan is the
 * evidence of what was refused and why, and it is structurally incapable
 * of authorizing a write (markPlanBlocked leaves it in `blocked`, and
 * `pr push` re-runs this same preflight before doing anything).
 */

export interface PrPrepareOptions {
  repository?: string;
  remote?: string;
  base: string;
  source?: string;
  title: string;
  bodyFile?: string;
  reviewer?: string[];
  ready?: boolean;
  requireProtectedBase?: boolean;
  tokenEnv?: string;
  portfolio?: string;
  member?: string;
}

export interface PrPrepareDeps extends CollectPrPreflightDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  /** Resolves an M46 portfolio member to exactly one repository root (WU47-05 wires the real resolver). */
  resolveMember?: (portfolioId: string, memberId: string) => { ok: true; root: string } | { ok: false; reason: string };
}

export async function runPrPrepare(ctx: CommandContext, options: PrPrepareOptions, deps: PrPrepareDeps = {}): Promise<CommandResult> {
  const now = deps.now ?? (() => new Date().toISOString());

  const titleError = validateTitle(options.title);
  if (titleError !== null) return titleError;

  const body = loadPrBody(options.bodyFile);
  if (!body.ok) return body.result;

  if ((options.portfolio === undefined) !== (options.member === undefined)) {
    return prFailure("--portfolio and --member must be provided together.", ExitCode.InvalidInput, "PR-PREPARE-INCOMPLETE-MEMBER-SELECTOR");
  }
  if (options.portfolio !== undefined && options.repository !== undefined) {
    return prFailure(
      "Provide either --repository or a --portfolio/--member selector, not both -- one plan always targets exactly one explicitly chosen repository.",
      ExitCode.InvalidInput,
      "PR-PREPARE-CONFLICTING-TARGET",
    );
  }

  let portfolioRef: PullRequestPortfolioRef | null = null;
  let repositoryRoot: string;
  if (options.portfolio !== undefined && options.member !== undefined) {
    if (deps.resolveMember === undefined) {
      return prFailure(
        "Portfolio member selection is not available in this build.",
        ExitCode.InvalidInput,
        "PR-PREPARE-MEMBER-RESOLUTION-UNAVAILABLE",
      );
    }
    const resolved = deps.resolveMember(options.portfolio, options.member);
    if (!resolved.ok) {
      return prFailure(resolved.reason, ExitCode.InvalidInput, "PR-PREPARE-MEMBER-NOT-RESOLVED");
    }
    repositoryRoot = resolved.root;
    portfolioRef = { portfolioId: options.portfolio, memberId: options.member };
  } else {
    repositoryRoot = resolve(ctx.cwd, options.repository ?? ".");
  }

  const remoteName = options.remote ?? "origin";
  const reviewers = normalizeReviewers(options.reviewer ?? []);
  const createMode = options.ready === true ? "ready" : "draft";
  const requireProtectedBase = options.requireProtectedBase === true;
  const { token, envName } = resolveToken(options.tokenEnv, deps.env);

  const collected = await collectPrPreflightObservations(
    {
      repositoryRoot,
      remoteName,
      baseBranch: options.base,
      sourceBranch: options.source ?? null,
      plannedSha: null,
      reviewers,
      createMode,
      requireProtectedBase,
      token,
    },
    deps,
  );

  const preflight = evaluatePrPreflight(collected.observations);
  const obs = collected.observations;
  const at = now();

  // Missing credentials get their own actionable failure rather than a
  // generic block, and nothing is persisted -- there is no partial state to
  // reconcile when no work was started.
  if (token === null) {
    return prFailure(
      `GitHub credentials are not available (environment variable "${envName}" is unset). Nothing was prepared and nothing was written.`,
      ExitCode.MissingDependency,
      "PR-PREPARE-MISSING-CREDENTIALS",
      { suggestedAction: missingPrCredentialActions(envName).join(" ") },
    );
  }

  const metadataDigest = computePrMetadataDigest({ title: options.title.trim(), body: body.body });
  const facts: PullRequestWriteBindingFacts = {
    provider: "github",
    repositoryRoot,
    remoteName,
    remoteRepositoryIdentity: obs.providerIdentity ?? obs.remoteIdentity ?? "unresolved",
    baseBranch: options.base,
    sourceBranch: obs.sourceBranch,
    sourceHeadSha: obs.sourceHeadSha ?? "unresolved",
    metadataDigest,
    reviewers,
    createMode,
    policy: { requireProtectedBase },
  };

  // A plan can only be persisted when its binding facts are real. Anything
  // less would create a plan whose "exact SHA" or "exact repository" is a
  // placeholder -- exactly the kind of half-valid state a later command
  // could misread.
  if (obs.sourceHeadSha === null || obs.remoteIdentity === null || obs.sourceBranch.length === 0) {
    return makeResult({
      status: "blocked",
      action: "pr",
      summary: `Preflight blocked before a plan could be bound: ${preflight.blocking.map((f) => f.message).join(" ")}`,
      exitCode: ExitCode.WorkflowBlocked,
      blockingIssues: preflightFindingsToIssues(preflight.blocking, "high"),
      warnings: preflightFindingsToIssues(preflight.warnings, "medium"),
      data: {
        preflight: { blocking: preflight.blocking, warnings: preflight.warnings, pushAllowed: false, createAllowed: false },
        providerError: collected.providerError,
      },
    });
  }

  let plan = createIntegrationPlan({ id: generatePrIntegrationId(), now: at, facts, title: options.title.trim(), portfolioRef });
  plan = recordBaseProtection(plan, { evidence: obs.baseProtection, checkedAt: at, detail: `Base protection evidence collected during prepare.` }, at);
  if (preflight.blocking.length > 0) {
    plan = markPlanBlocked(plan, at, preflight.blocking.map((f) => `${f.id}: ${f.message}`).join(" | "));
  }

  const home = resolvePrIntegrationHome();
  writePrIntegrationPlan(home, plan);
  const capability = evaluatePlanCapability(plan);

  const blocked = preflight.blocking.length > 0;
  return makeResult({
    status: blocked ? "blocked" : "passed",
    action: "pr",
    summary: blocked
      ? `Integration plan ${plan.id} prepared and blocked: ${preflight.blocking.map((f) => f.message).join(" ")}`
      : `Integration plan ${plan.id} prepared: ${plan.remoteRepositoryIdentity} ${plan.sourceBranch}@${plan.sourceHeadSha.slice(0, 12)} -> ${plan.baseBranch}, ${plan.createMode} PR, ${plan.reviewers.length} reviewer(s). Nothing has been pushed and no Pull Request exists.`,
    exitCode: blocked ? ExitCode.WorkflowBlocked : ExitCode.Success,
    completedActions: ["Ran read-only preflight", "Wrote integration plan"],
    changedFiles: [resolvePrIntegrationFilePath(home, plan.id)],
    affectedItems: [plan.id],
    blockingIssues: preflightFindingsToIssues(preflight.blocking, "high"),
    warnings: preflightFindingsToIssues(preflight.warnings, "medium"),
    nextRecommendedCommand: blocked ? null : `aiqt pr push ${plan.id}`,
    data: {
      plan,
      preflight: { blocking: preflight.blocking, warnings: preflight.warnings, pushAllowed: preflight.pushAllowed, createAllowed: preflight.createAllowed },
      capability,
      providerError: collected.providerError,
    },
  });
}

/**
 * `aiqt pr inspect <integration-id>` (build spec Sec 6): read-only
 * rendering of a persisted plan. Performs no repository read, no remote
 * read, and no provider call -- it reports exactly what the plan records,
 * which is what makes it safe to run at any time, including while an
 * ambiguous outcome is pending.
 */
export function runPrInspect(_ctx: CommandContext, integrationId: string): CommandResult {
  const loaded = loadPlan(integrationId);
  if (!loaded.ok) return loaded.result;
  const { plan } = loaded;
  const capability = evaluatePlanCapability(plan);

  return makeResult({
    status: "passed",
    action: "pr",
    summary: `Plan ${plan.id} [${plan.status}]: ${plan.remoteRepositoryIdentity} ${plan.sourceBranch}@${plan.sourceHeadSha.slice(0, 12)} -> ${plan.baseBranch}. ${capability.reason}`,
    exitCode: ExitCode.Success,
    affectedItems: [plan.id],
    data: { plan, capability },
  });
}
