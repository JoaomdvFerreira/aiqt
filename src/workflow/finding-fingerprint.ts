import { sha256Hex } from "../core/util/hash.js";
import { slugify } from "../services/issue-service.js";
import type { ScopeClaim } from "../schema/evidence.schema.js";
import type { DecisionEscalationCategory } from "../schema/decision-escalation.schema.js";

/**
 * M22 §6.1: deterministic text/related-ID normalization shared by both the
 * fingerprint and the canonical issue key -- both must resolve identically
 * for the same logical finding regardless of array iteration order.
 */
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeRelatedIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()))].sort();
}

export interface NormalizedFindingInput {
  title: string;
  summary: string;
  relatedIds: readonly string[];
  scopeClaim: ScopeClaim;
}

/**
 * M22 §6.1: a stable digest of the finding's normalized content. Order-
 * independent for `relatedIds` (explicitly sorted and deduplicated before
 * hashing). Two findings with the same title/summary/relatedIds/scope
 * always fingerprint identically, regardless of when or in what order they
 * were reported.
 */
export function computeSourceFingerprint(input: NormalizedFindingInput): string {
  const normalized = {
    title: normalizeText(input.title),
    summary: normalizeText(input.summary),
    relatedIds: normalizeRelatedIds(input.relatedIds),
    scopeClaim: input.scopeClaim,
  };
  return sha256Hex(JSON.stringify(normalized));
}

/**
 * M22 §6.1/§9: mints a new canonical issue key for a finding that has no
 * existing CheckpointIssue/ProjectIssue to link to, using the
 * `evidence:<scopeClaim>:<slug>[-N]` convention -- the same occurrence-
 * index collision-avoidance scheme as the existing
 * `checkpoint:<workUnitId>:issue:<slug>[-N]` convention in
 * issue-service.ts (checkpointIssueKey), reused via the shared `slugify`
 * helper rather than reimplemented. Callers resolving a finding that
 * already matches an existing CheckpointIssue or ProjectIssue must reuse
 * that record's stored issueKey instead of minting a new one -- this
 * function is only for a genuinely new canonical condition.
 */
export function mintEvidenceIssueKey(scopeClaim: ScopeClaim, title: string, occurrenceIndex: number): string {
  const slug = slugify(title);
  return occurrenceIndex === 0
    ? `evidence:${scopeClaim}:${slug}`
    : `evidence:${scopeClaim}:${slug}-${occurrenceIndex + 1}`;
}

/**
 * M23-WU06: M22 defined `DecisionEscalation.escalationKey` (§5.7) but never
 * instantiated a minting convention for it, since no M22-era command ever
 * created one. Follows the exact same deterministic
 * `<domain>:<category>:<slug>[-N]` convention as `mintEvidenceIssueKey`
 * and `checkpointIssueKey`, reusing the same `slugify` helper -- so a
 * repeated import of the same logical escalation (same category+question)
 * always resolves to the same key and links rather than duplicating.
 */
export function mintDecisionEscalationKey(
  category: DecisionEscalationCategory,
  question: string,
  occurrenceIndex: number,
): string {
  const slug = slugify(question);
  return occurrenceIndex === 0
    ? `escalation:${category}:${slug}`
    : `escalation:${category}:${slug}-${occurrenceIndex + 1}`;
}
