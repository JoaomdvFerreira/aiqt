/**
 * M19/M19-RC1 §6-§9: deterministic relevant-change classification via one
 * explicit allowlist -- a changed path requires a version increment only
 * when it matches one of these prefixes/exact paths. No heuristic text
 * scanning, no directory-existence assumptions: a path is listed here only
 * because it is (or, for a well-known universal convention like README.md,
 * unambiguously would be the moment it exists) part of AIQT's public
 * contract. Adding a new relevant surface (e.g. a future `docs/cli/`
 * reference tree) means adding an explicit entry here and to
 * docs/versioning.md's rationale table -- never inferring it from content.
 *
 * Directory entries match by prefix (after normalizing to forward slashes);
 * file entries match exactly. As of M19-RC1, `git ls-files docs/` shows
 * this repository has exactly one tracked documentation file
 * (docs/versioning.md -- everything else under docs/ is local-only PDFs
 * and spec drafts, gitignored via docs/* + a per-file negation); there is
 * no docs/cli/**, docs/commands/**, docs/reference/**, docs/workflow/**,
 * docs/architecture/**, or docs/specifications/** in the actual repository
 * structure, so none of those speculative paths are listed below.
 */

/** Each entry's own comment documents *why* it defines AIQT's public contract. */
const RELEVANT_DIRECTORY_PREFIXES: readonly string[] = [
  "src/", // all product source: CLI commands/flags/exit codes, schemas, workflow engine, graph validation/repair, handoff packets, runtime output contracts, and this tool itself.
  ".github/workflows/", // release-validation/CI tooling -- changing what gets enforced is itself a release-governance-relevant change.
];

const RELEVANT_EXACT_FILES: readonly string[] = [
  "package.json", // the canonical version source, and the published command/dependency surface.
  "pnpm-lock.yaml", // resolved dependency versions that ship with every release.
  "docs/versioning.md", // the contributor-facing release/version policy itself.
  "README.md", // the universal public entry point (install/usage/compatibility) -- listed even though this repository does not yet have one, so the policy is already correct the moment it is added; git diff simply never matches a nonexistent path until then.
];

/** Normalize a repository-relative path to forward slashes for cross-platform comparison. */
export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isRelevantPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  if (RELEVANT_EXACT_FILES.includes(normalized)) return true;
  return RELEVANT_DIRECTORY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export interface PathClassification {
  relevantPaths: string[];
  ignoredPaths: string[];
  relevantChangesDetected: boolean;
}

/** Classify a list of changed (repository-relative) paths. Output is sorted for deterministic reporting. */
export function classifyChangedPaths(paths: readonly string[]): PathClassification {
  const relevantPaths: string[] = [];
  const ignoredPaths: string[] = [];
  for (const raw of paths) {
    const normalized = normalizeRepoPath(raw);
    if (normalized === "") continue;
    if (isRelevantPath(normalized)) relevantPaths.push(normalized);
    else ignoredPaths.push(normalized);
  }
  relevantPaths.sort();
  ignoredPaths.sort();
  return {
    relevantPaths,
    ignoredPaths,
    relevantChangesDetected: relevantPaths.length > 0,
  };
}
