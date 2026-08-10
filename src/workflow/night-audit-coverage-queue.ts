import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { NightAuditCoverageEntry, NightReviewDomain, ReviewTask } from "../schema/night-audit.schema.js";

/**
 * M48-WU02 (build spec Sec 6 "Queue priority"): pure, deterministic
 * change-aware queue planning. No I/O, no wall-clock reads -- every
 * function takes already-collected facts as explicit plain data, mirroring
 * maintenance-due-engine.ts's injectable-clock discipline. The caller
 * (WU48-05's session service) is responsible for gathering the real facts
 * (changed paths, defect signals, churn) and passing them in.
 */

/** One (domain, scope) pair the caller currently considers reviewable -- never "the whole repository". */
export interface ReviewCandidateScope {
  domain: NightReviewDomain;
  scope: string;
}

export type QueuePriorityTier = 1 | 2 | 3 | 4 | 5 | 6;

export type QueuePriorityTierLabel =
  | "changed_since_review"
  | "never_reviewed"
  | "stale_coverage"
  | "recent_defect_signal"
  | "high_churn"
  | "rotation";

const TIER_LABELS: Record<QueuePriorityTier, QueuePriorityTierLabel> = {
  1: "changed_since_review",
  2: "never_reviewed",
  3: "stale_coverage",
  4: "recent_defect_signal",
  5: "high_churn",
  6: "rotation",
};

export interface ScoredReviewCandidate {
  candidate: ReviewCandidateScope;
  tier: QueuePriorityTier;
  tierLabel: QueuePriorityTierLabel;
  lastReviewedAt: string | null;
}

/** Build spec Sec 6: coverage becomes stale after this many days without review, independent of whether anything changed. */
export const STALE_COVERAGE_DAYS = 30;

function candidateKey(candidate: ReviewCandidateScope): string {
  return `${candidate.domain}::${candidate.scope}`;
}

export interface QueuePlanningInput {
  /** The exhaustive set of (domain, scope) pairs the caller currently considers reviewable. */
  candidates: readonly ReviewCandidateScope[];
  /** The existing coverage ledger (state.nightAuditCoverage ?? []). */
  coverage: readonly NightAuditCoverageEntry[];
  /** Candidate keys ("domain::scope") whose scope has changed since coverage.lastReviewedCommit. */
  changedScopeKeys: ReadonlySet<string>;
  /** Candidate keys with a recent defect/finding signal (e.g. a fresh M42 defect touching that scope). */
  recentDefectSignalScopeKeys: ReadonlySet<string>;
  /** Candidate keys with high recent churn (caller-defined threshold already applied). */
  highChurnScopeKeys: ReadonlySet<string>;
  nowIso: string;
}

/**
 * Build spec Sec 6: scores every candidate into exactly one priority tier
 * via a sequential decision list (tier 1 checked first), then sorts by
 * tier ascending, then by `lastReviewedAt` ascending (staler first; never
 * reviewed sorts first via `null` handling), then by candidate key
 * lexicographically as the final deterministic tie-break -- identical
 * inputs always produce an identical ordering.
 */
export function scoreReviewCandidates(input: QueuePlanningInput): ScoredReviewCandidate[] {
  const coverageByKey = new Map<string, NightAuditCoverageEntry>();
  for (const entry of input.coverage) {
    coverageByKey.set(`${entry.domain}::${entry.scope}`, entry);
  }

  const nowMs = Date.parse(input.nowIso);
  const staleThresholdMs = STALE_COVERAGE_DAYS * 24 * 60 * 60 * 1000;

  const scored: ScoredReviewCandidate[] = input.candidates.map((candidate) => {
    const key = candidateKey(candidate);
    const entry = coverageByKey.get(key) ?? null;

    let tier: QueuePriorityTier;
    if (entry !== null && input.changedScopeKeys.has(key)) {
      tier = 1;
    } else if (entry === null) {
      tier = 2;
    } else if (nowMs - Date.parse(entry.lastReviewedAt) >= staleThresholdMs) {
      tier = 3;
    } else if (input.recentDefectSignalScopeKeys.has(key)) {
      tier = 4;
    } else if (input.highChurnScopeKeys.has(key)) {
      tier = 5;
    } else {
      tier = 6;
    }

    return { candidate, tier, tierLabel: TIER_LABELS[tier], lastReviewedAt: entry?.lastReviewedAt ?? null };
  });

  return scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const aTime = a.lastReviewedAt === null ? -Infinity : Date.parse(a.lastReviewedAt);
    const bTime = b.lastReviewedAt === null ? -Infinity : Date.parse(b.lastReviewedAt);
    if (aTime !== bTime) return aTime - bTime;
    return candidateKey(a.candidate).localeCompare(candidateKey(b.candidate));
  });
}

/**
 * Build spec Sec 5: a deterministic task identity over exactly the facts
 * that determine "which task this is" -- domain, scope, and the exact
 * commit it executes against -- mirroring computeOccurrenceId's digest
 * discipline (maintenance-due-engine.ts) rather than a random id.
 */
export function computeReviewTaskId(domain: NightReviewDomain, scope: string, repositoryCommit: string): string {
  return computeCanonicalPayloadDigest({ domain, scope, repositoryCommit });
}

/**
 * Build spec Sec 4: deterministic, budget-aware selection -- takes the
 * front of the already-sorted queue, bounded by however many tasks the
 * remaining budget allows. Never selects more than the queue actually
 * contains.
 */
export function selectReviewTasksForBudget(
  scored: readonly ScoredReviewCandidate[],
  repositoryCommit: string,
  remainingTaskBudget: number,
): ReviewTask[] {
  if (remainingTaskBudget <= 0) return [];
  return scored.slice(0, remainingTaskBudget).map((s) => ({
    taskId: computeReviewTaskId(s.candidate.domain, s.candidate.scope, repositoryCommit),
    domain: s.candidate.domain,
    scope: s.candidate.scope,
    repositoryCommit,
  }));
}

/** Build spec Sec 10: the fixed, explainable diminishing-return threshold -- never an opaque model self-assessment. */
export const DIMINISHING_RETURN_CONSECUTIVE_EMPTY_THRESHOLD = 5;

/**
 * Build spec Sec 10: stop only when both hold -- enough consecutive
 * completed tasks produced zero accepted findings, AND no priority-1/2
 * (changed-since-review / never-reviewed) scope remains. A queue with only
 * stale-rotation-priority scope left is exactly the case this is meant to
 * short-circuit; a queue that still has high-priority scope never stops
 * here regardless of the empty-streak length.
 */
export function shouldStopForDiminishingReturns(consecutiveTasksWithNoAcceptedFindings: number, remainingHighPriorityCandidateCount: number): boolean {
  return consecutiveTasksWithNoAcceptedFindings >= DIMINISHING_RETURN_CONSECUTIVE_EMPTY_THRESHOLD && remainingHighPriorityCandidateCount === 0;
}

/** Convenience: count of remaining tier-1/tier-2 (changed-since-review / never-reviewed) candidates in an already-scored queue. */
export function countRemainingHighPriorityCandidates(scored: readonly ScoredReviewCandidate[]): number {
  return scored.filter((s) => s.tier === 1 || s.tier === 2).length;
}
