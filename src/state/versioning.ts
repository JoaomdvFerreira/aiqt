import { AIQT_SCHEMA_VERSION } from "../core/constants/schema-version.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { Issue } from "../core/output/issue.js";

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(value: string): Semver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export const UNSUPPORTED_VERSION_MESSAGE = [
  "AIQT cannot continue.",
  "Reason:",
  "This project was created with a newer AIQT version.",
  "Suggested action:",
  "Upgrade AIQT to the latest version.",
].join("\n");

function versionIssue(id: string, message: string): Issue {
  return {
    id,
    severity: "critical",
    area: "version",
    message,
    suggestedAction: "Upgrade AIQT to the latest version.",
    agentCanFix: false,
  };
}

/**
 * Validate a canonical file's `version` field against AIQT_SCHEMA_VERSION.
 * Missing, wrong-typed, malformed, or future versions block with exit code 3.
 * Equal or older versions proceed (schema validation is the further gate).
 */
export function assertCompatibleVersion(
  version: unknown,
  fileLabel: string,
): void {
  if (typeof version !== "string") {
    throw new AiqtError(
      `Invalid or missing version in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue(
        "VERSION-INVALID-TYPE",
        `The ${fileLabel} version field is missing or not a string.`,
      ),
    );
  }

  const parsed = parseSemver(version);
  if (!parsed) {
    throw new AiqtError(
      `Invalid version "${version}" in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue(
        "VERSION-INVALID",
        `The ${fileLabel} version "${version}" is not a valid semantic version.`,
      ),
    );
  }

  const current = parseSemver(AIQT_SCHEMA_VERSION);
  // AIQT_SCHEMA_VERSION is a compile-time constant known to be valid.
  if (current && compareSemver(parsed, current) > 0) {
    throw new AiqtError(
      UNSUPPORTED_VERSION_MESSAGE,
      ExitCode.InvalidInput,
      versionIssue(
        "VERSION-UNSUPPORTED",
        `The ${fileLabel} version "${version}" is newer than the supported schema version ${AIQT_SCHEMA_VERSION}.`,
      ),
    );
  }
}
