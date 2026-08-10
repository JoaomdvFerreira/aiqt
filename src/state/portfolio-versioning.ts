import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { Issue } from "../core/output/issue.js";
import { PORTFOLIO_SCHEMA_VERSION } from "../schema/portfolio.schema.js";

/**
 * M46-WU01: portfolio-manifest version compatibility, independent of
 * src/state/versioning.ts (the canonical project-state gate). A separate,
 * narrower policy is deliberate: the portfolio schema is new and has no
 * historical compatibility matrix to preserve yet. Same major version is
 * accepted (forward-compatible reads within the major); any other major
 * (including future ones) is rejected before mutation, matching the
 * canonical store's fail-closed posture on unsupported versions.
 */

function parseMajor(version: string): number | null {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version.trim());
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

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

export function assertCompatiblePortfolioVersion(version: unknown, fileLabel: string): void {
  if (typeof version !== "string") {
    throw new AiqtError(
      `Invalid or missing schemaVersion in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue("PORTFOLIO-VERSION-INVALID-TYPE", `The ${fileLabel} schemaVersion field is missing or not a string.`),
    );
  }

  const major = parseMajor(version);
  const currentMajor = parseMajor(PORTFOLIO_SCHEMA_VERSION);
  if (major === null || currentMajor === null) {
    throw new AiqtError(
      `Invalid schemaVersion "${version}" in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue("PORTFOLIO-VERSION-INVALID", `The ${fileLabel} schemaVersion "${version}" is not a valid semantic version.`),
    );
  }

  if (major !== currentMajor) {
    throw new AiqtError(
      `Unsupported portfolio schema version "${version}" in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue(
        "PORTFOLIO-VERSION-UNSUPPORTED",
        `The ${fileLabel} schemaVersion "${version}" is not compatible with the supported major version ${currentMajor} (current: ${PORTFOLIO_SCHEMA_VERSION}).`,
      ),
    );
  }
}
