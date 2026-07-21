import type { StateModel } from "../schema/state.schema.js";
import type { ReviewResult } from "./review-service.js";
import type {
  IssueOverride,
  IssueOverrideStatus,
  IssuePromotion,
} from "../schema/issue-state.schema.js";
import type { Checkpoint, CheckpointIssue } from "../schema/checkpoint.schema.js";
import { classifyCheckpointIssue } from "../workflow/issue-classification.js";

/** M11 §8.1: missing state.issues must be treated as empty override/promotion arrays. */
export function getIssueOverrides(state: StateModel): IssueOverride[] {
  return state.issues?.overrides ?? [];
}

export function getIssuePromotions(state: StateModel): IssuePromotion[] {
  return state.issues?.promotions ?? [];
}

export function findIssueOverride(
  issueKey: string,
  overrides: readonly IssueOverride[],
): IssueOverride | undefined {
  return overrides.find((o) => o.issueKey === issueKey);
}

export function findIssuePromotion(
  issueKey: string,
  promotions: readonly IssuePromotion[],
): IssuePromotion | undefined {
  return promotions.find((p) => p.issueKey === issueKey);
}

export function effectiveIssueStatus(
  issueKey: string,
  overrides: readonly IssueOverride[],
): IssueOverrideStatus {
  return findIssueOverride(issueKey, overrides)?.status ?? "active";
}

/**
 * §9: deterministic slug derived from normalized issue text, truncated for
 * readability. Not an attempt to reproduce any specific illustrative
 * example verbatim -- only required to be deterministic and stable for the
 * same source text.
 */
/**
 * M22-WU06: exported so finding-fingerprint.ts can reuse the exact same
 * slug normalization for the new evidence:<scope>:<slug> issue-key
 * convention, instead of reimplementing it.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "issue";
}

/**
 * §9: checkpoint:<workUnitId>:issue:<slug> pattern. When two issues on the
 * same work unit normalize to the same slug, later occurrences (in stored
 * checkpoints/issues order) get a stable numeric suffix so keys never
 * collide while remaining deterministic across runs.
 */
export function checkpointIssueKey(
  workUnitId: string,
  title: string,
  occurrenceIndex: number,
): string {
  const slug = slugify(title);
  return occurrenceIndex === 0
    ? `checkpoint:${workUnitId}:issue:${slug}`
    : `checkpoint:${workUnitId}:issue:${slug}-${occurrenceIndex + 1}`;
}

/** §9: review:<findingKey> pattern, reusing the M9/M10 stable finding key as-is. */
export function reviewIssueKey(findingKey: string): string {
  return `review:${findingKey}`;
}

/**
 * M23-WU06: standalone lookup for an existing open CheckpointIssue by its
 * canonical `checkpointIssueKey`, exposed as a reusable owner rather than
 * leaving `buildNormalizedIssues`' equivalent scan as an unexposed
 * internal side effect. Recomputes each open issue's key with the exact
 * same slug/occurrence-index scheme `buildNormalizedIssues` uses (scoped
 * per `workUnitId`, in state.checkpoints order), so the result always
 * agrees with what `aiqt issue list` would show. Checkpoints are
 * immutable once created (see checkpoint-amendment-service.ts) -- this is
 * a read-only lookup, never a mutation path.
 */
export function findCheckpointIssueByKey(
  state: StateModel,
  issueKey: string,
): { checkpoint: Checkpoint; issue: CheckpointIssue } | undefined {
  const slugOccurrences = new Map<string, number>();
  for (const cp of state.checkpoints) {
    for (const issue of cp.issues) {
      if (issue.status !== "open") continue;
      const slug = slugify(issue.title);
      const occurrenceMapKey = `${cp.workUnitId}::${slug}`;
      const occurrenceIndex = slugOccurrences.get(occurrenceMapKey) ?? 0;
      slugOccurrences.set(occurrenceMapKey, occurrenceIndex + 1);
      if (checkpointIssueKey(cp.workUnitId, issue.title, occurrenceIndex) === issueKey) {
        return { checkpoint: cp, issue };
      }
    }
  }
  return undefined;
}

function extractWorkUnitId(relatedIds: readonly string[]): string | null {
  return relatedIds.find((id) => /^WU\d+$/.test(id)) ?? null;
}

export type IssueSource = "checkpoint" | "review";

export type IssueClassificationTag =
  | "user_action_required"
  | "external_verification_gap"
  | "agent_fixable"
  | "release_blocker"
  | "backlog_candidate";

/** Raw, override-independent classification signals, reused for both issue-list display and manage/export bucket construction. */
export interface RawIssueClassification {
  userActionRequired: boolean;
  externalVerificationGap: boolean;
  agentFixable: boolean;
  releaseBlocking: boolean;
  backlogCandidate: boolean;
}

export interface NormalizedIssue {
  issueKey: string;
  source: IssueSource;
  workUnitId: string | null;
  /** Effective status: the stored override's status, or "active" if none exists. */
  status: IssueOverrideStatus;
  classification: IssueClassificationTag[];
  message: string;
  promotedWorkUnitId: string | null;
  raw: RawIssueClassification;
}

function tagsFromRaw(raw: RawIssueClassification): IssueClassificationTag[] {
  const tags: IssueClassificationTag[] = [];
  if (raw.userActionRequired) tags.push("user_action_required");
  if (raw.externalVerificationGap) tags.push("external_verification_gap");
  if (raw.agentFixable) tags.push("agent_fixable");
  if (raw.releaseBlocking) tags.push("release_blocker");
  if (raw.backlogCandidate) tags.push("backlog_candidate");
  return tags;
}

/**
 * §12: the effective issue view, built in canonical precedence order:
 * (1) canonical checkpoint/review data, (2) M10 classification (reused via
 * classifyCheckpointIssue, not reimplemented), (3) M11 overrides,
 * (4) M11 promotion links. This is the single source of both `aiqt issue
 * list` and the manage/final-review classification buckets -- M11 must not
 * create a second classifier.
 */
export function buildNormalizedIssues(
  state: StateModel,
  review: ReviewResult,
): NormalizedIssue[] {
  const overrides = getIssueOverrides(state);
  const promotions = getIssuePromotions(state);
  const issues: NormalizedIssue[] = [];

  const slugOccurrences = new Map<string, number>();
  for (const cp of state.checkpoints) {
    for (const issue of cp.issues) {
      if (issue.status !== "open") continue;

      const slug = slugify(issue.title);
      const occurrenceMapKey = `${cp.workUnitId}::${slug}`;
      const occurrenceIndex = slugOccurrences.get(occurrenceMapKey) ?? 0;
      slugOccurrences.set(occurrenceMapKey, occurrenceIndex + 1);
      const issueKey = checkpointIssueKey(cp.workUnitId, issue.title, occurrenceIndex);

      const raw = classifyCheckpointIssue(issue);
      const promotion = findIssuePromotion(issueKey, promotions);

      issues.push({
        issueKey,
        source: "checkpoint",
        workUnitId: cp.workUnitId,
        status: effectiveIssueStatus(issueKey, overrides),
        classification: tagsFromRaw(raw),
        message: issue.title,
        promotedWorkUnitId: promotion?.workUnitId ?? null,
        raw,
      });
    }
  }

  for (const finding of review.findings) {
    if (!finding.blocking) continue;

    const issueKey = reviewIssueKey(finding.findingKey);
    const raw: RawIssueClassification = {
      userActionRequired: finding.category === "context",
      externalVerificationGap: finding.findingKey.startsWith("checkpoint:"),
      agentFixable: false,
      releaseBlocking: true,
      backlogCandidate: false,
    };
    const promotion = findIssuePromotion(issueKey, promotions);

    issues.push({
      issueKey,
      source: "review",
      workUnitId: extractWorkUnitId(finding.relatedIds),
      status: effectiveIssueStatus(issueKey, overrides),
      classification: tagsFromRaw(raw),
      message: finding.message,
      promotedWorkUnitId: promotion?.workUnitId ?? null,
      raw,
    });
  }

  return issues;
}

/**
 * §11.2/§14: an issue can be promoted into repair work only if it is not
 * already resolved and is classified as agent-fixable or release-blocking
 * (the same signal `aiqt repair plan` uses to recommend it).
 */
export function isPromotable(issue: NormalizedIssue): boolean {
  if (issue.status === "resolved") return false;
  return issue.raw.agentFixable || issue.raw.releaseBlocking;
}

/** Look up a single normalized issue by key, or undefined if not currently active. */
export function findNormalizedIssue(
  issueKey: string,
  issues: readonly NormalizedIssue[],
): NormalizedIssue | undefined {
  return issues.find((i) => i.issueKey === issueKey);
}
