/**
 * Section 3.4: commit-bound freshness. A finding is `current` only when
 * its `reviewCommit` matches the repository's present HEAD; any other
 * relationship (including an unknown/unrelated commit) is `stale` and
 * must not silently enter the defect queue at intake (WU43-04) --
 * intake either re-evaluates or explicitly rejects a stale finding.
 */
export type StructuralFindingFreshness = "current" | "stale";

export function evaluateStructuralFindingFreshness(reviewCommit: string, currentCommit: string): StructuralFindingFreshness {
  return reviewCommit === currentCommit ? "current" : "stale";
}
