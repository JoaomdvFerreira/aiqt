/**
 * M19 §13/§22.1: minimal, dependency-free SemVer 2.0.0 parsing and ordering.
 * Deliberately narrow -- this repo-tooling module has no need for ranges,
 * build-metadata comparison beyond spec-required precedence, or any of the
 * features a general-purpose semver library would add. Never compare
 * version strings lexicographically (the `0.10.0` vs `0.9.0` trap).
 */

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  buildMetadata: string[];
  raw: string;
}

export type VersionIncrement = "major" | "minor" | "patch" | "prerelease-only" | "none";

/** Parse a SemVer string, or return null if it is not valid SemVer 2.0.0. */
export function parseSemver(input: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, majorStr, minorStr, patchStr, prereleaseStr, buildStr] = match;
  return {
    major: Number(majorStr),
    minor: Number(minorStr),
    patch: Number(patchStr),
    prerelease: prereleaseStr ? prereleaseStr.split(".") : [],
    buildMetadata: buildStr ? buildStr.split(".") : [],
    raw: input.trim(),
  };
}

export function isValidSemver(input: string): boolean {
  return parseSemver(input) !== null;
}

/** True if `input` is exactly its own normalized SemVer form (no surrounding whitespace, no "v" prefix, no leading zeros). */
export function isNormalizedSemver(input: string): boolean {
  const parsed = parseSemver(input);
  if (!parsed) return false;
  return formatSemver(parsed) === input;
}

export function formatSemver(v: ParsedVersion): string {
  let out = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length > 0) out += `-${v.prerelease.join(".")}`;
  if (v.buildMetadata.length > 0) out += `+${v.buildMetadata.join(".")}`;
  return out;
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aIsNum = /^\d+$/.test(a);
  const bIsNum = /^\d+$/.test(b);
  if (aIsNum && bIsNum) return Number(a) - Number(b);
  if (aIsNum) return -1; // numeric identifiers always have lower precedence than alphanumeric.
  if (bIsNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SemVer 2.0.0 precedence (build metadata is ignored, per spec §11.4). A
 * release version (no prerelease) always has higher precedence than a
 * prerelease of the same major.minor.patch.
 */
export function compareSemver(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1; // a is a release, b is a prerelease.
  if (b.prerelease.length === 0) return -1;

  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    if (i >= a.prerelease.length) return -1; // fewer fields = lower precedence.
    if (i >= b.prerelease.length) return 1;
    const cmp = comparePrereleaseIdentifier(a.prerelease[i], b.prerelease[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * The apparent minimum increment level from `base` to `current`, for
 * informational reporting only (M19 §14) -- enforcement never depends on
 * this being exactly right, only on monotonic increase.
 */
export function classifyIncrement(base: ParsedVersion, current: ParsedVersion): VersionIncrement {
  if (current.major !== base.major) return "major";
  if (current.minor !== base.minor) return "minor";
  if (current.patch !== base.patch) return "patch";
  if (compareSemver(current, base) !== 0) return "prerelease-only";
  return "none";
}
