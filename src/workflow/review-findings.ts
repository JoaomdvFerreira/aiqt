import { formatId } from "../state/ids.js";
import type { ReviewFindingCandidate } from "./review-rules.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Sort findings deterministically (§9.2: blocking first, then severity, then
 * category, then joined relatedIds, then rule key) and assign per-run
 * FIND-### ids. FIND ids are ephemeral: they are recomputed every run and
 * never persisted or continued from a previous run.
 */
export function sortAndAssignFindingIds(
  candidates: readonly ReviewFindingCandidate[],
): ReviewFinding[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;

    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;

    if (a.category !== b.category) return a.category < b.category ? -1 : 1;

    const aRelated = a.relatedIds.join(",");
    const bRelated = b.relatedIds.join(",");
    if (aRelated !== bRelated) return aRelated < bRelated ? -1 : 1;

    return a.ruleKey < b.ruleKey ? -1 : a.ruleKey > b.ruleKey ? 1 : 0;
  });

  return sorted.map((candidate, index) => {
    const { ruleKey, ...rest } = candidate;
    void ruleKey;
    return {
      id: formatId("FIND", index + 1, "-"),
      ...rest,
    };
  });
}
