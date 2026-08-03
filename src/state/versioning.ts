import { AIQT_SCHEMA_VERSION } from "../core/constants/schema-version.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { Issue } from "../core/output/issue.js";

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export type CanonicalVersionCompatibility =
  | "current"
  | "older_compatible"
  | "older_incompatible"
  | "unsupported_future";

const MINIMUM_COMPATIBLE_SCHEMA_VERSION = "0.1.0";

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

const INCOMPATIBLE_OLDER_VERSION_MESSAGE = [
  "AIQT cannot continue.",
  "Reason:",
  "This project uses an unsupported older canonical schema version.",
  "Suggested action:",
  "Migrate the project with an AIQT version that supports that schema.",
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

function currentSchemaVersion(): Semver {
  const current = parseSemver(AIQT_SCHEMA_VERSION);
  if (!current) {
    throw new Error(`Invalid AIQT_SCHEMA_VERSION constant: ${AIQT_SCHEMA_VERSION}`);
  }
  return current;
}

function minimumCompatibleSchemaVersion(): Semver {
  const minimum = parseSemver(MINIMUM_COMPATIBLE_SCHEMA_VERSION);
  if (!minimum) {
    throw new Error(`Invalid minimum compatible schema version: ${MINIMUM_COMPATIBLE_SCHEMA_VERSION}`);
  }
  return minimum;
}

export function classifyCanonicalVersion(version: string): CanonicalVersionCompatibility {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new AiqtError(
      `Invalid version "${version}".`,
      ExitCode.InvalidInput,
      versionIssue(
        "VERSION-INVALID",
        `The canonical version "${version}" is not a valid semantic version.`,
      ),
    );
  }

  const current = currentSchemaVersion();
  if (compareSemver(parsed, current) > 0) {
    return "unsupported_future";
  }

  const minimum = minimumCompatibleSchemaVersion();
  if (compareSemver(parsed, minimum) < 0) {
    return "older_incompatible";
  }

  if (compareSemver(parsed, current) === 0) {
    return "current";
  }

  return "older_compatible";
}

/**
 * Validate a canonical file's `version` field against AIQT_SCHEMA_VERSION.
 * Missing, wrong-typed, malformed, incompatible older, or future versions
 * block with exit code 3. Current and compatible older versions proceed
 * (schema validation is the further gate).
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

  const compatibility = classifyCanonicalVersion(version);
  if (compatibility === "unsupported_future") {
    throw new AiqtError(
      UNSUPPORTED_VERSION_MESSAGE,
      ExitCode.InvalidInput,
      versionIssue(
        "VERSION-UNSUPPORTED",
        `The ${fileLabel} version "${version}" is newer than the supported schema version ${AIQT_SCHEMA_VERSION}.`,
      ),
    );
  }

  if (compatibility === "older_incompatible") {
    throw new AiqtError(
      INCOMPATIBLE_OLDER_VERSION_MESSAGE,
      ExitCode.InvalidInput,
      versionIssue(
        "VERSION-OLDER-INCOMPATIBLE",
        `The ${fileLabel} version "${version}" is older than the minimum supported schema version ${MINIMUM_COMPATIBLE_SCHEMA_VERSION}.`,
      ),
    );
  }
}
