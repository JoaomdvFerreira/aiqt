/**
 * M19 §11/§12: deterministic relevant-change classification via one
 * explicit allowlist -- a changed path requires a version increment only
 * when it matches one of these prefixes/exact paths. Everything else
 * (tests/**, coverage/**, editor config, gitignored/local artifacts, any
 * docs/ file other than the versioning policy itself) is deterministically
 * exempt. No heuristic text scanning; adding a new relevant surface means
 * adding an explicit entry here.
 *
 * Directory entries match by prefix (after normalizing to forward slashes);
 * file entries match exactly. Public CLI documentation is covered because
 * `docs/versioning.md` -- the one tracked file under the otherwise-ignored
 * `docs/` directory -- is listed explicitly; the CLI's own --help text
 * lives in src/cli/** and is already covered by the src/ prefix.
 */
const RELEVANT_DIRECTORY_PREFIXES: readonly string[] = ["src/", ".github/workflows/"];

const RELEVANT_EXACT_FILES: readonly string[] = ["package.json", "pnpm-lock.yaml", "docs/versioning.md"];

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
