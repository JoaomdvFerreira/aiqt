import { normalizeRepoPath } from "./relevant-paths.js";

/**
 * IH-05 (CI & Test Portfolio Rationalization): change-aware validation
 * profiles for `.github/workflows/validate.yml`.
 *
 * This is deliberately NOT `relevant-paths.ts`. That module answers "does
 * this change require a version bump?"; this one answers "can this change
 * safely skip the test suite?". The two questions have different
 * consequences for being wrong, so they get different, independently
 * reviewed allowlists — a path must never become test-skippable as a side
 * effect of someone editing the version-governance allowlist.
 *
 * Fail-closed by construction: `full` is the only default. A change is
 * classified `docs-only` **only** when every single changed path matches
 * the narrow allowlist below. An empty change list, an unresolvable base,
 * an unreadable diff, or any single unrecognised path all yield `full`.
 */

export type ValidationProfile = "docs-only" | "full";

/**
 * Directories whose contents cannot influence any test outcome.
 *
 * `docs/` qualifies because no test in this repository reads this
 * repository's own `docs/` tree as an input: the structural-review,
 * owner-map, workflow and versioning suites all construct their fixtures
 * in temp directories, and the only two tests that touch the real `docs/`
 * path (`autonomous-controlled-pilot`, `autonomous-run-dogfood-pilot`)
 * *write* generated evidence there rather than asserting on tracked
 * content. `tests/unit/validation-profile.test.ts` pins that fact to a
 * reviewed baseline, so a future test that starts reading `docs/` breaks
 * the guard instead of silently making this profile unsound.
 */
const DOCS_ONLY_DIRECTORY_PREFIXES: readonly string[] = ["docs/"];

export interface ValidationProfileDecision {
  profile: ValidationProfile;
  reason: string;
  changedPaths: string[];
  disqualifyingPaths: string[];
}

function isDocsOnlyPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return DOCS_ONLY_DIRECTORY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function classifyValidationProfile(
  paths: readonly string[],
): ValidationProfileDecision {
  const changedPaths = paths
    .map((p) => normalizeRepoPath(p))
    .filter((p) => p !== "")
    .sort();

  if (changedPaths.length === 0) {
    return {
      profile: "full",
      reason:
        "no changed paths could be determined -- falling back to full validation",
      changedPaths,
      disqualifyingPaths: [],
    };
  }

  const disqualifyingPaths = changedPaths.filter((p) => !isDocsOnlyPath(p));
  if (disqualifyingPaths.length > 0) {
    return {
      profile: "full",
      reason: `${disqualifyingPaths.length} changed path(s) outside the documentation allowlist`,
      changedPaths,
      disqualifyingPaths,
    };
  }

  return {
    profile: "docs-only",
    reason: `all ${changedPaths.length} changed path(s) are documentation under docs/`,
    changedPaths,
    disqualifyingPaths: [],
  };
}
