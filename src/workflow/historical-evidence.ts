import {
  gitCommitTimeIso,
  gitIsAncestor,
  gitListTags,
  gitRevParse,
  gitShowFileAtCommit,
  GitRunnerError,
} from "../workspaces/git-command-runner.js";
import { parseSemver, compareSemver, type ParsedVersion } from "../tooling/semver.js";
import type { HistoricalMilestoneRef } from "../schema/historical-reconstruction.schema.js";

/**
 * M44-WU02: bounded, repository-local historical-evidence collection.
 * Every exported function here is a pure read against `git` (via the
 * existing M25 allowlisted runner, extended with a handful of new
 * read-only ops in this WU) or a bounded file read at a specific commit.
 * No mutation, no network, no broad source-code scan -- discovery is
 * limited to Git tags, ancestry, and two well-known file paths
 * (package.json, schema-version.ts) resolved at a specific commit.
 */

const PACKAGE_MANIFEST_PATH = "package.json";
const SCHEMA_VERSION_PATH = "src/core/constants/schema-version.ts";
const SCHEMA_VERSION_PATTERN = /AIQT_SCHEMA_VERSION\s*=\s*"([^"]+)"/;

/** Milestone-closure tag shape (e.g. "m40-historical-release-reconstruction"), excluding per-Work-Unit tags (e.g. "m40-wu01-..."). */
const MILESTONE_TAG_PATTERN = /^m(\d+)-(?!wu\d)/i;
const CLOSURE_REPORT_CANDIDATE_PATHS = (milestoneNumber: string): string[] => [
  `docs/milestones/completed/m${milestoneNumber}/closure-report.md`,
  `docs/archive/milestones/m${milestoneNumber}/closure-report.md`,
];

/** Resolves any ref to a full commit sha, or null if it cannot be resolved (never throws). */
export function resolveRefSafely(cwd: string, ref: string): string | null {
  try {
    return gitRevParse(cwd, ref);
  } catch (err) {
    if (err instanceof GitRunnerError) return null;
    throw err;
  }
}

/** Strips at most one leading "v" (the repository's tagging convention) before SemVer parsing. Never strips a "v" that is not immediately followed by a digit. */
function tagToSemver(tag: string): ParsedVersion | null {
  const candidate = /^v\d/.test(tag) ? tag.slice(1) : tag;
  return parseSemver(candidate);
}

export interface DiscoveredReleaseTag {
  tag: string;
  version: ParsedVersion;
  commit: string;
}

/**
 * Every local tag that is valid SemVer (build spec Sec 7.1), each resolved
 * to its exact target commit. A tag that does not parse as SemVer or does
 * not resolve to a commit is silently excluded from the release-target
 * inventory -- it is simply not a release-target tag, not a fabricated one.
 */
export function discoverSemverReleaseTags(cwd: string): DiscoveredReleaseTag[] {
  const tags = gitListTags(cwd);
  const discovered: DiscoveredReleaseTag[] = [];
  for (const tag of tags) {
    const version = tagToSemver(tag);
    if (!version) continue;
    const commit = resolveRefSafely(cwd, `refs/tags/${tag}^{commit}`);
    if (!commit) continue;
    discovered.push({ tag, version, commit });
  }
  return discovered.sort((a, b) => compareSemver(a.version, b.version));
}

/** Package version recorded in package.json at `commit`, or null if the file did not exist or was not parseable JSON with a string `version` field there (build spec Sec 7.1, Sec 6.2: never the current working tree). */
export function readPackageVersionAtCommit(cwd: string, commit: string): string | null {
  const raw = gitShowFileAtCommit(cwd, commit, PACKAGE_MANIFEST_PATH);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const version = (parsed as { version: unknown }).version;
      return typeof version === "string" ? version : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** AIQT_SCHEMA_VERSION recorded at `commit`, or null if the schema-version file did not exist there or did not match the expected literal-export shape (build spec Sec 7.1: "when relevant" -- most managed projects will not have this file at all). */
export function readSchemaVersionAtCommit(cwd: string, commit: string): string | null {
  const raw = gitShowFileAtCommit(cwd, commit, SCHEMA_VERSION_PATH);
  if (raw === null) return null;
  const match = SCHEMA_VERSION_PATTERN.exec(raw);
  return match ? match[1] : null;
}

/** Git-metadata commit time for `commit`, or null if unresolvable. */
export function readTargetCommitTime(cwd: string, commit: string): string | null {
  return gitCommitTimeIso(cwd, commit);
}

export interface BaseReleaseSelection {
  baseRelease: string | null;
  ambiguous: boolean;
}

/**
 * Ancestry-aware base-release selection (build spec Sec 8). Restricts
 * candidates to tags that are true Git ancestors of the target commit --
 * semantic-version ordering alone never overrides ancestry. Among ancestor
 * candidates, the base is the unique one that every other ancestor
 * candidate is itself an ancestor of (i.e. the ancestor "nearest" to the
 * target in the commit graph). When no such unique maximal element exists
 * (divergent branch history with two or more equally plausible bases),
 * selection fails closed to ambiguous rather than guessing by version
 * order (build spec Sec 8 point 3-4, dogfood scenarios 9-11).
 */
export function selectBaseRelease(
  cwd: string,
  targetCommit: string,
  candidates: readonly DiscoveredReleaseTag[],
): BaseReleaseSelection {
  const ancestors = candidates.filter(
    (c) => c.commit !== targetCommit && gitIsAncestor(cwd, c.commit, targetCommit),
  );
  if (ancestors.length === 0) return { baseRelease: null, ambiguous: false };

  const maximal = ancestors.filter((c) =>
    ancestors.every((other) => other.commit === c.commit || gitIsAncestor(cwd, other.commit, c.commit)),
  );
  if (maximal.length === 1) return { baseRelease: maximal[0].tag, ambiguous: false };
  return { baseRelease: null, ambiguous: true };
}

/**
 * Milestone references evidenced by a milestone-closure Git tag that is an
 * ancestor of (or equal to) the target commit, cross-checked against the
 * two known closure-report locations at that same commit (build spec Sec
 * 7.1, Sec 8 point 5-7). Never inferred from title/filename similarity
 * (build spec Sec 6.2). A milestone whose tag is evidenced but whose
 * closure report cannot be found at either known path is reported
 * `partial`, not fabricated as `verified`.
 */
export function discoverMilestoneReferences(cwd: string, targetCommit: string): HistoricalMilestoneRef[] {
  const tags = gitListTags(cwd);
  const refs: HistoricalMilestoneRef[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const match = MILESTONE_TAG_PATTERN.exec(tag);
    if (!match) continue;
    const milestoneNumber = match[1];
    const milestoneId = `m${milestoneNumber}`;
    if (seen.has(milestoneId)) continue;

    const tagCommit = resolveRefSafely(cwd, `refs/tags/${tag}^{commit}`);
    if (!tagCommit) continue;
    if (tagCommit !== targetCommit && !gitIsAncestor(cwd, tagCommit, targetCommit)) continue;

    seen.add(milestoneId);
    const closureReportPath = CLOSURE_REPORT_CANDIDATE_PATHS(milestoneNumber).find(
      (path) => gitShowFileAtCommit(cwd, targetCommit, path) !== null,
    );

    refs.push({
      milestoneId,
      tag,
      tagCommit,
      closureReportPath: closureReportPath ?? null,
      closureCommit: null,
      evidenceStatus: closureReportPath ? "verified" : "partial",
    });
  }

  return refs.sort((a, b) => a.milestoneId.localeCompare(b.milestoneId, "en", { numeric: true }));
}
