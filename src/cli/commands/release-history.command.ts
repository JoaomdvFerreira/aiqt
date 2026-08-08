import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { listHistoricalReleaseTargets } from "../../services/historical-reconstruction-service.js";

/**
 * `aiqt release history` (M44-WU02, build spec Sec 4.1): read-only inventory
 * of bounded, repository-local historical release targets -- every local
 * SemVer Git tag, resolved to its commit and cross-checked against
 * package.json at that commit. No network, no mutation, no milestone/base
 * reconstruction (that belongs to the explicit `release reconstruct <tag>`
 * assessment, M44-WU03) -- this is discovery only.
 */
export interface ReleaseHistoryOptions {
  cwd?: string;
}

export function runReleaseHistory(ctx: CommandContext): CommandResult {
  const targets = listHistoricalReleaseTargets(ctx.cwd);
  const conflicting = targets.filter((t) => t.versionMatchesTag === false).length;

  return makeResult({
    status: conflicting > 0 ? "warning" : "passed",
    action: "release",
    summary:
      targets.length === 0
        ? "No SemVer release tags found in this repository."
        : `${targets.length} historical release target(s) found${conflicting > 0 ? `, ${conflicting} with a tag/package-version conflict` : ""}.`,
    exitCode: ExitCode.Success,
    data: { targets },
  });
}
