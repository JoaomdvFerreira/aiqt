import type { ContextItem, ContextPriority, ContextProfile, WorkComplexity } from "../schema/execution-guidance.schema.js";

/**
 * M39-WU02 (build spec Sec 6, "Context manifest"/"Budgeting"): the pure,
 * deterministic context-manifest builder. This module never reads a file,
 * an environment variable, or a secret, and never recursively ingests a
 * directory -- every candidate reference is supplied by the caller as
 * plain data (a path/synthetic-ref string plus an optional size hint).
 * Real repository/checkpoint reads belong to a future consumer-wiring
 * Work Unit, not here.
 */

const CONTEXT_PROFILE_TARGET_TOKENS: Record<ContextProfile, number> = {
  // Heuristic, provider-neutral soft targets -- never a real provider
  // context-window limit. Configurable per call via
  // `targetEstimatedTokensOverride`.
  minimal: 2000,
  focused: 6000,
  expanded: 15000,
};

const DEFAULT_ITEM_TOKEN_ESTIMATE = 200;
const BYTES_PER_TOKEN_ESTIMATE = 4;

function estimateTokensForItem(sizeBytes: number | undefined): number {
  if (sizeBytes == null) return DEFAULT_ITEM_TOKEN_ESTIMATE;
  return Math.max(1, Math.ceil(sizeBytes / BYTES_PER_TOKEN_ESTIMATE));
}

/** `work-unit:`/`issue:`/`dependency:`/`constraint:` prefixed references are logical identifiers, not filesystem paths -- the path-safety check below does not apply to them. */
function isSyntheticRef(ref: string): boolean {
  return /^(work-unit|issue|dependency|constraint):/.test(ref);
}

/**
 * Rejects absolute paths and `..` traversal segments (build spec Sec 6:
 * "never include paths outside approved roots"). Deliberately
 * conservative -- a relative, traversal-free path is the only shape ever
 * accepted; the caller is expected to already scope `suggestedFiles`/
 * dependency changed-file paths to the repository.
 */
export function isPathWithinApprovedRoots(path: string): boolean {
  if (path.length === 0) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.split(/[\\/]/).some((segment) => segment === "..")) return false;
  return true;
}

export function deriveContextProfile(complexity: WorkComplexity): ContextProfile {
  switch (complexity) {
    case "mechanical":
    case "simple":
      return "minimal";
    case "standard":
      return "focused";
    case "complex":
    case "architectural":
      return "expanded";
  }
}

interface ContextCandidate {
  path: string;
  priority: ContextPriority;
  reason: string;
  sizeBytes?: number;
}

export interface DependencyContextInput {
  workUnitId: string;
  changedFiles: readonly string[];
}

export interface ContextManifestInput {
  workUnitId: string;
  complexity: WorkComplexity;
  explicitAgentContextRefs?: readonly string[];
  suggestedFiles?: readonly string[];
  dependencyContext?: readonly DependencyContextInput[];
  unresolvedIssueRefs?: readonly string[];
  projectConstraintRefs?: readonly string[];
  /** Operator-configured hard ceiling. When set and must-read alone exceeds it, the manifest fails closed (a recorded warning, never a silent must-read truncation) rather than guessing a safe cut. */
  hardLimitTokens?: number | null;
  /** Overrides the profile's default soft target; still a heuristic, never a provider limit. */
  targetEstimatedTokensOverride?: number | null;
}

function dedupeByPath(candidates: readonly ContextCandidate[]): ContextCandidate[] {
  const seen = new Map<string, ContextCandidate>();
  for (const candidate of candidates) {
    if (!seen.has(candidate.path)) seen.set(candidate.path, candidate);
  }
  return [...seen.values()];
}

function toItem(candidate: ContextCandidate): ContextItem {
  return { path: candidate.path, priority: candidate.priority, reason: candidate.reason };
}

/**
 * Builds the prioritized, bounded context manifest (build spec Sec 6).
 * Ordering favors, in this fixed sequence: (1) the current Work Unit's own
 * contract (always must_read, never dropped), (2) explicit
 * `agentContextRefs` (must_read), (3) exact `suggestedFiles` paths and (4)
 * direct-dependency changed files (should_read), (5) unresolved issues and
 * (6) project constraints (reference_only). Lower tiers are demoted/
 * omitted first when the soft token target would otherwise be exceeded;
 * must_read is never demoted or truncated -- only a recorded
 * `MUST_READ_OVERFLOW` warning when a configured hard limit cannot contain
 * it.
 */
export function buildContextManifest(input: ContextManifestInput) {
  const warnings: string[] = [];
  const profile = deriveContextProfile(input.complexity);
  const target = input.targetEstimatedTokensOverride ?? CONTEXT_PROFILE_TARGET_TOKENS[profile];

  const mustReadCandidates: ContextCandidate[] = [
    {
      path: `work-unit:${input.workUnitId}`,
      priority: "must_read",
      reason: "Current Work Unit objective/scope/out-of-scope/acceptance-criteria contract; never dropped.",
    },
    ...(input.explicitAgentContextRefs ?? []).map((ref) => ({
      path: ref,
      priority: "must_read" as const,
      reason: "Explicit agentContextRefs entry.",
    })),
  ];
  const shouldReadCandidates: ContextCandidate[] = [
    ...(input.suggestedFiles ?? []).map((path) => ({
      path,
      priority: "should_read" as const,
      reason: "Exact suggestedFiles path.",
    })),
    ...(input.dependencyContext ?? []).flatMap((dep) =>
      dep.changedFiles.map((path) => ({
        path,
        priority: "should_read" as const,
        reason: `Changed by direct dependency ${dep.workUnitId}.`,
      })),
    ),
  ];
  const referenceOnlyCandidates: ContextCandidate[] = [
    ...(input.unresolvedIssueRefs ?? []).map((ref) => ({
      path: `issue:${ref}`,
      priority: "reference_only" as const,
      reason: "Directly relevant unresolved issue/risk.",
    })),
    ...(input.projectConstraintRefs ?? []).map((ref) => ({
      path: ref,
      priority: "reference_only" as const,
      reason: "Compact project/business/technology constraint.",
    })),
  ];

  function filterSafe(candidates: ContextCandidate[]): ContextCandidate[] {
    const safe: ContextCandidate[] = [];
    for (const candidate of candidates) {
      if (isSyntheticRef(candidate.path) || isPathWithinApprovedRoots(candidate.path)) {
        safe.push(candidate);
      } else {
        warnings.push(`Excluded out-of-root/unsafe path reference: "${candidate.path}".`);
      }
    }
    return safe;
  }

  const mustRead = dedupeByPath(filterSafe(mustReadCandidates));
  const alreadyIncluded = new Set(mustRead.map((c) => c.path));
  const shouldRead = dedupeByPath(filterSafe(shouldReadCandidates)).filter((c) => !alreadyIncluded.has(c.path));
  for (const c of shouldRead) alreadyIncluded.add(c.path);
  const referenceOnly = dedupeByPath(filterSafe(referenceOnlyCandidates)).filter((c) => !alreadyIncluded.has(c.path));

  const mustReadCost = mustRead.reduce((sum, c) => sum + estimateTokensForItem(c.sizeBytes), 0);
  if (input.hardLimitTokens != null && mustReadCost > input.hardLimitTokens) {
    warnings.push(
      `MUST_READ_OVERFLOW: mandatory context alone (~${mustReadCost} estimated tokens) exceeds the configured hard limit (${input.hardLimitTokens}); human review required before proceeding. Must-read items are still included, never silently truncated.`,
    );
  }

  const items: ContextItem[] = mustRead.map(toItem);
  let runningTotal = mustReadCost;

  function tryAddTier(tier: ContextCandidate[], tierLabel: string): void {
    let omittedCount = 0;
    for (const candidate of tier) {
      const cost = estimateTokensForItem(candidate.sizeBytes);
      if (runningTotal + cost > target) {
        omittedCount += 1;
        continue;
      }
      items.push(toItem(candidate));
      runningTotal += cost;
    }
    if (omittedCount > 0) {
      warnings.push(`${omittedCount} ${tierLabel} item(s) omitted to stay within the "${profile}" token target (~${target} estimated tokens).`);
    }
  }
  tryAddTier(shouldRead, "should_read");
  tryAddTier(referenceOnly, "reference_only");

  return {
    profile,
    targetEstimatedTokens: target,
    estimatedTokens: runningTotal,
    items,
    warnings,
  };
}
