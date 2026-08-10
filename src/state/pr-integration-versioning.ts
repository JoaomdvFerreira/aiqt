import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { Issue } from "../core/output/issue.js";
import { PR_INTEGRATION_SCHEMA_VERSION } from "../schema/pull-request-integration.schema.js";

/**
 * M47-WU01: PR-integration-plan version compatibility. Independent of both
 * src/state/versioning.ts (the canonical project-state gate) and
 * src/state/portfolio-versioning.ts (M46's registry gate) -- three separate
 * schema domains, deliberately not merged, so a change to one can never
 * force a version bump on the others.
 *
 * Policy mirrors M46's: same major accepted, any other major rejected
 * before mutation. Fail-closed matters more here than anywhere else in the
 * repository -- a plan is the record of what remote side effects already
 * happened, so acting on a plan this binary cannot fully understand risks
 * duplicating a push or a Pull Request.
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

export function assertCompatiblePrIntegrationVersion(version: unknown, fileLabel: string): void {
  if (typeof version !== "string") {
    throw new AiqtError(
      `Invalid or missing schemaVersion in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue("PR-INTEGRATION-VERSION-INVALID-TYPE", `The ${fileLabel} schemaVersion field is missing or not a string.`),
    );
  }

  const major = parseMajor(version);
  const currentMajor = parseMajor(PR_INTEGRATION_SCHEMA_VERSION);
  if (major === null || currentMajor === null) {
    throw new AiqtError(
      `Invalid schemaVersion "${version}" in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue("PR-INTEGRATION-VERSION-INVALID", `The ${fileLabel} schemaVersion "${version}" is not a valid semantic version.`),
    );
  }

  if (major !== currentMajor) {
    throw new AiqtError(
      `Unsupported PR integration schema version "${version}" in ${fileLabel}.`,
      ExitCode.InvalidInput,
      versionIssue(
        "PR-INTEGRATION-VERSION-UNSUPPORTED",
        `The ${fileLabel} schemaVersion "${version}" is not compatible with the supported major version ${currentMajor} (current: ${PR_INTEGRATION_SCHEMA_VERSION}).`,
      ),
    );
  }
}
