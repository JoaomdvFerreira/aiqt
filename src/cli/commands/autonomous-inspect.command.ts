import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { runRepositoryPreflight } from "../../workflow/autonomous-run-preflight.js";
import { isAiqtOwnRepository } from "../../workflow/autonomous-run-self-management-guard.js";
import { autonomousFailure } from "./autonomous-shared.js";

/**
 * M37-WU01 (build spec: "aiqt autonomous inspect"). Real, read-only
 * repository preflight -- reuses M36-WU02's runRepositoryPreflight
 * verbatim. No run record is created here; inspect is a pre-classify
 * preview a human can run repeatedly and freely.
 */
export interface AutonomousInspectOptions {
  repository?: string;
  baseRef?: string;
}

export function runAutonomousInspect(_ctx: CommandContext, options: AutonomousInspectOptions): CommandResult {
  if (!options.repository || options.repository.trim() === "") {
    return autonomousFailure("aiqt autonomous inspect requires --repository <path>.", ExitCode.InvalidInput, "AUTONOMOUS-INSPECT-NO-REPOSITORY");
  }
  if (!options.baseRef || options.baseRef.trim() === "") {
    return autonomousFailure("aiqt autonomous inspect requires --base-ref <ref>.", ExitCode.InvalidInput, "AUTONOMOUS-INSPECT-NO-BASE-REF");
  }
  if (isAiqtOwnRepository(options.repository)) {
    return autonomousFailure(
      "aiqt autonomous inspect refuses to target the AIQT product's own repository (self-management is never permitted).",
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-INSPECT-SELF-TARGET",
    );
  }

  const preflight = runRepositoryPreflight(options.repository, options.baseRef);

  const summary = !preflight.isGitRepository
    ? "Target path is not a Git repository."
    : preflight.repositoryDirty
      ? "Target repository is a Git repository but has uncommitted changes."
      : !preflight.baseRefResolvable
        ? "Target repository is clean but the base ref does not resolve."
        : "Target repository is clean and the base ref resolves. Ready for classification.";

  return makeResult({
    status: "passed",
    action: "autonomous",
    summary,
    exitCode: ExitCode.Success,
    nextRecommendedCommand: preflight.isGitRepository && !preflight.repositoryDirty && preflight.baseRefResolvable ? "aiqt autonomous classify" : null,
    data: { repository: options.repository, baseRef: options.baseRef, preflight },
  });
}
