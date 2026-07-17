/**
 * M19-RC1 §12/§17.3: pure decision logic for resolving the comparison base
 * of a direct push to `main`. Kept separate from any git/process I/O so it
 * is directly unit-testable; `resolve-push-base-cli.ts` is the thin CLI
 * wrapper the CI workflow actually invokes, so the workflow YAML and this
 * tested logic can never drift apart into two hand-synced implementations.
 */

export const GIT_ZERO_SHA = "0000000000000000000000000000000000000000";

export type PushBaseAction = "compare" | "skip-initial" | "error-unresolvable";

export interface PushBaseResolution {
  action: PushBaseAction;
  /** Present only when action === "compare". */
  base?: string;
  reason: string;
}

/**
 * Decide what a direct push to `main` should do, given GitHub's own
 * `github.event.before` value and a caller-supplied check for whether that
 * SHA actually resolves to a known commit in the current checkout.
 *
 * - `github.event.before` missing/empty, or the all-zero SHA GitHub sends
 *   for a branch's first push -- there is no previous revision to compare
 *   against. This is expected and safe: skip comparison, local consistency
 *   mode still runs.
 * - `before` is a non-empty, non-zero SHA that does NOT resolve (e.g. the
 *   checkout's history doesn't reach it) -- this is an anomaly, not an
 *   expected "no previous revision" case, and must fail structurally
 *   rather than silently skip enforcement.
 * - Otherwise, compare against it.
 */
export function resolveDirectPushBase(
  before: string | undefined,
  commitResolves: (sha: string) => boolean,
): PushBaseResolution {
  const trimmed = (before ?? "").trim();
  if (trimmed === "" || trimmed === GIT_ZERO_SHA) {
    return {
      action: "skip-initial",
      reason:
        "No previous revision available (missing github.event.before, or the all-zero SHA GitHub sends for a branch's first push) -- comparison skipped, local consistency validation still runs.",
    };
  }
  if (!commitResolves(trimmed)) {
    return {
      action: "error-unresolvable",
      reason: `github.event.before ("${trimmed}") does not resolve to a known commit in this checkout -- cannot safely enforce the version policy for this push.`,
    };
  }
  return {
    action: "compare",
    base: trimmed,
    reason: "Comparing against github.event.before.",
  };
}
