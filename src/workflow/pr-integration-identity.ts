import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import { PR_INTEGRATION_SCHEMA_VERSION, MAX_PR_REVIEWERS } from "../schema/pull-request-integration.schema.js";
import type {
  PullRequestIntegrationPlan,
  PullRequestCreateMode,
  PullRequestIntegrationPolicy,
  PullRequestProvider,
} from "../schema/pull-request-integration.schema.js";

/**
 * M47-WU01: plan identity, PR metadata digesting, and the freshness
 * (staleness) decision that every remote write is gated on.
 *
 * Pure module: no filesystem, no process, no network. It decides whether a
 * plan may still be acted on; it never performs the action. Digesting
 * reuses M23's canonical-JSON + SHA-256 helper verbatim
 * (src/schema/external-evidence/canonical-json.ts) rather than introducing
 * a second hashing scheme.
 */

const PR_INTEGRATION_ID_PATTERN = /^pri-\d+-[0-9a-f]{8}$/;

/** The only shape generatePrIntegrationId() ever produces -- also the only shape the store accepts, so an operator-supplied id can never construct a path outside the integration home. */
export function isValidPrIntegrationId(id: string): boolean {
  return PR_INTEGRATION_ID_PATTERN.test(id);
}

export function generatePrIntegrationId(): string {
  return `pri-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * M47 binds an exact commit, never an abbreviation or a ref. A short SHA
 * is ambiguous by construction and would let "the same plan" resolve to a
 * different commit later, which is precisely the hazard exact-SHA binding
 * exists to close.
 */
export function isFullCommitSha(value: string): boolean {
  return FULL_SHA_PATTERN.test(value.trim().toLowerCase());
}

/**
 * Normalized explicit reviewer set: trimmed, empty entries dropped,
 * de-duplicated case-insensitively (GitHub logins are case-insensitive, so
 * "Octocat" and "octocat" are one reviewer, not two), and sorted so the
 * digest cannot change merely because the operator typed the same reviewers
 * in a different order. The first spelling encountered is preserved for
 * display; comparison is always on the lowercase form.
 */
export function normalizeReviewers(reviewers: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of reviewers) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
  }
  return kept.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function reviewerCountExceedsLimit(reviewers: readonly string[]): boolean {
  return normalizeReviewers(reviewers).length > MAX_PR_REVIEWERS;
}

/**
 * The digest freshness is decided on for PR metadata. The body text is
 * digested, not stored in the plan: the plan is a safety record, not a
 * content store, and a changed body must invalidate the plan whether or
 * not anyone can still read the original text.
 */
export function computePrMetadataDigest(metadata: { title: string; body: string }): string {
  return computeCanonicalPayloadDigest({
    schemaVersion: PR_INTEGRATION_SCHEMA_VERSION,
    title: metadata.title,
    body: metadata.body,
  });
}

/** Every fact that, if changed, makes a prepared plan unsafe to act on (build spec Sec 7). */
export interface PullRequestWriteBindingFacts {
  provider: PullRequestProvider;
  repositoryRoot: string;
  remoteName: string;
  remoteRepositoryIdentity: string;
  baseBranch: string;
  sourceBranch: string;
  sourceHeadSha: string;
  metadataDigest: string;
  reviewers: readonly string[];
  createMode: PullRequestCreateMode;
  policy: PullRequestIntegrationPolicy;
}

/**
 * Case handling mirrors M46's isSameRoot (src/services/portfolio-service.ts):
 * Windows and macOS paths are case-insensitive but case-preserving, so two
 * roots differing only in case are the same repository there and different
 * ones on a case-sensitive filesystem. Case-folding here (rather than at
 * comparison time only) keeps the stored bindingDigest and the field-by-
 * field freshness check from ever disagreeing about the same pair of paths.
 * Repository identity ("owner/repo") is likewise case-insensitive on
 * GitHub, matching release-draft.command.ts's existing lowercase comparison.
 */
function normalizeRoot(root: string): string {
  const resolved = resolve(root);
  return process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved;
}

interface NormalizedWriteBindingFacts {
  provider: string;
  repositoryRoot: string;
  remoteName: string;
  remoteRepositoryIdentity: string;
  baseBranch: string;
  sourceBranch: string;
  sourceHeadSha: string;
  metadataDigest: string;
  reviewers: string[];
  createMode: string;
  requireProtectedBase: boolean;
}

export function normalizeWriteBindingFacts(facts: PullRequestWriteBindingFacts): NormalizedWriteBindingFacts {
  return {
    provider: facts.provider,
    repositoryRoot: normalizeRoot(facts.repositoryRoot),
    // Branch names and remote names are case-SENSITIVE in Git; never fold them.
    remoteName: facts.remoteName,
    remoteRepositoryIdentity: facts.remoteRepositoryIdentity.toLowerCase(),
    baseBranch: facts.baseBranch,
    sourceBranch: facts.sourceBranch,
    sourceHeadSha: facts.sourceHeadSha.trim().toLowerCase(),
    metadataDigest: facts.metadataDigest,
    reviewers: normalizeReviewers(facts.reviewers).map((r) => r.toLowerCase()),
    createMode: facts.createMode,
    requireProtectedBase: facts.policy.requireProtectedBase,
  };
}

/**
 * sha256 over the normalized write-relevant facts, prefixed with this
 * schema's version so a future contract change cannot silently produce a
 * colliding digest for a differently-shaped fact set.
 */
export function computePrWriteBindingDigest(facts: PullRequestWriteBindingFacts): string {
  return computeCanonicalPayloadDigest({
    schemaVersion: PR_INTEGRATION_SCHEMA_VERSION,
    binding: normalizeWriteBindingFacts(facts),
  });
}

/** The write-relevant facts a persisted plan committed to, for comparison against freshly observed reality. */
export function writeBindingFactsFromPlan(plan: PullRequestIntegrationPlan): PullRequestWriteBindingFacts {
  return {
    provider: plan.provider,
    repositoryRoot: plan.repositoryRoot,
    remoteName: plan.remoteName,
    remoteRepositoryIdentity: plan.remoteRepositoryIdentity,
    baseBranch: plan.baseBranch,
    sourceBranch: plan.sourceBranch,
    sourceHeadSha: plan.sourceHeadSha,
    metadataDigest: plan.metadataDigest,
    reviewers: plan.reviewers,
    createMode: plan.createMode,
    policy: plan.policy,
  };
}

export interface ChangedBindingFact {
  fact: string;
  planned: string;
  observed: string;
}

export type PlanFreshness =
  | { fresh: true }
  | { fresh: false; changedFacts: ChangedBindingFact[] };

const COMPARED_FACTS: { key: keyof NormalizedWriteBindingFacts; label: string }[] = [
  { key: "provider", label: "provider" },
  { key: "repositoryRoot", label: "repositoryRoot" },
  { key: "remoteName", label: "remoteName" },
  { key: "remoteRepositoryIdentity", label: "remoteRepositoryIdentity" },
  { key: "baseBranch", label: "baseBranch" },
  { key: "sourceBranch", label: "sourceBranch" },
  { key: "sourceHeadSha", label: "sourceHeadSha" },
  { key: "metadataDigest", label: "metadataDigest" },
  { key: "reviewers", label: "reviewers" },
  { key: "createMode", label: "createMode" },
  { key: "requireProtectedBase", label: "policy.requireProtectedBase" },
];

function renderFact(value: NormalizedWriteBindingFacts[keyof NormalizedWriteBindingFacts]): string {
  return Array.isArray(value) ? (value.length === 0 ? "(none)" : value.join(", ")) : String(value);
}

/**
 * Build spec Sec 7/19: a plan is stale when ANY write-relevant fact
 * changed, and a stale plan can neither push nor create. Comparison is
 * field-by-field (rather than digest-only) so the operator is told exactly
 * which fact moved; the stored bindingDigest is additionally re-derived and
 * compared, which catches a plan file that was edited in place to keep the
 * observable fields consistent while the digest no longer matches them.
 */
export function evaluatePlanFreshness(plan: PullRequestIntegrationPlan, observed: PullRequestWriteBindingFacts): PlanFreshness {
  const plannedFacts = writeBindingFactsFromPlan(plan);
  const planned = normalizeWriteBindingFacts(plannedFacts);
  const actual = normalizeWriteBindingFacts(observed);

  const changedFacts: ChangedBindingFact[] = [];
  for (const { key, label } of COMPARED_FACTS) {
    const a = renderFact(planned[key]);
    const b = renderFact(actual[key]);
    if (a !== b) changedFacts.push({ fact: label, planned: a, observed: b });
  }

  const expectedDigest = computePrWriteBindingDigest(plannedFacts);
  if (expectedDigest !== plan.bindingDigest) {
    changedFacts.push({ fact: "bindingDigest", planned: plan.bindingDigest, observed: expectedDigest });
  }

  return changedFacts.length === 0 ? { fresh: true } : { fresh: false, changedFacts };
}

/** One-line, operator-readable rendering of why a plan is stale. */
export function describeStaleness(changedFacts: readonly ChangedBindingFact[]): string {
  return changedFacts.map((c) => `${c.fact}: planned "${c.planned}", now "${c.observed}"`).join("; ");
}
