import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import {
  reconstructHistoricalReleaseWithExternalEvidence,
  type ExternalVerificationDeps,
} from "../../services/historical-reconstruction-service.js";
import { releaseFailure, blockingFindingToIssue, warningToIssue, mapReadinessIntegrity } from "./release-shared.js";
import type { ReconstructionStatus } from "../../schema/historical-reconstruction.schema.js";

/**
 * `aiqt release reconstruct <tag>` (M44-WU03/WU04, build spec Sec 4.1, 11):
 * explicit-target, read-only reconstruction and assessment. Never publishes,
 * drafts, tags, merges, or mutates -- reconstructs a bounded evidence ledger
 * for the one requested tag, layers the bounded external existing-release
 * lookup on top (reusing M40's exact getReleaseByTag adapter), and, when
 * sufficiently evidenced, maps it into the existing M40 candidate/
 * provenance/readiness/risk/approval/notes flow.
 */
export interface ReleaseReconstructOptions {
  tag: string;
  repository: string;
  /** Name of the environment variable holding the GitHub token. Defaults to GITHUB_TOKEN. Never a token value itself. */
  tokenEnv?: string;
}

const STATUS_EXIT: Record<ReconstructionStatus, { status: "passed" | "warning" | "failed" | "blocked"; exitCode: number }> = {
  existing_release: { status: "passed", exitCode: ExitCode.Success },
  reconstructable: { status: "passed", exitCode: ExitCode.Success },
  reconstructable_with_warnings: { status: "warning", exitCode: ExitCode.Success },
  partial: { status: "warning", exitCode: ExitCode.Success },
  conflicting: { status: "blocked", exitCode: ExitCode.WorkflowBlocked },
  insufficient_evidence: { status: "failed", exitCode: ExitCode.ValidationFailed },
};

export async function runReleaseReconstruct(
  ctx: CommandContext,
  options: ReleaseReconstructOptions,
  deps: ExternalVerificationDeps = {},
): Promise<CommandResult> {
  if (!options.repository.trim()) {
    return releaseFailure("Provide --repository <identity> to identify the reconstructed candidate's repository.", ExitCode.InvalidInput, "RELEASE-RECONSTRUCT-MISSING-REPOSITORY");
  }

  const outcome = await reconstructHistoricalReleaseWithExternalEvidence(ctx.cwd, options.repository, options.tag, {
    ...deps,
    tokenEnvName: options.tokenEnv ?? deps.tokenEnvName,
  });
  if (!outcome.ok) {
    return releaseFailure(`Release tag "${options.tag}" was not found in this repository.`, ExitCode.InvalidInput, "RELEASE-RECONSTRUCT-TAG-NOT-FOUND");
  }

  const { assessment, decision, m40BlockingFindings, retrospectiveNotes, existingRelease } = outcome.result;
  const mapping = STATUS_EXIT[assessment.status];

  const m40Findings = m40BlockingFindings.map((f) => blockingFindingToIssue(f));
  const readinessFindings = decision ? decision.readiness.blockingFindings.map(blockingFindingToIssue) : [];
  const warnings = decision ? decision.readiness.warnings.map(warningToIssue) : [];

  // A found existing release always takes priority over M40's readiness for
  // the reported command status/exit code: reconstruction must not propose
  // duplicate publication as the default next action for a target that is
  // already released (build spec Sec 11). A decision otherwise means M40
  // itself already assessed readiness -- that mapping is authoritative over
  // the coarser reconstruction-quality mapping (M40 remains the sole
  // readiness/risk/approval-authority owner, build spec Sec 9).
  const readinessMapping =
    assessment.status !== "existing_release" && decision && m40BlockingFindings.length === 0
      ? mapReadinessIntegrity(decision.readiness.integrity)
      : null;
  const finalMapping = readinessMapping ?? mapping;

  const existingReleaseNote =
    existingRelease.releaseStatus === "found"
      ? ` A published GitHub Release already exists (${existingRelease.releaseUrl}) -- no duplicate publication proposed.`
      : existingRelease.draftStatus === "found"
        ? ` An existing GitHub Release draft was found (${existingRelease.draftUrl}) -- no duplicate draft proposed.`
        : "";

  return makeResult({
    status: finalMapping.status,
    action: "release",
    summary:
      (m40BlockingFindings.length > 0
        ? `Reconstruction quality "${assessment.status}" for "${options.tag}", but M40 candidate assembly failed: ${m40BlockingFindings.map((f) => f.message).join("; ")}`
        : decision
          ? `Reconstruction quality "${assessment.status}" for "${options.tag}": candidate integrity "${decision.readiness.integrity}", risk ${decision.risk?.totalScore ?? "n/a"}/100.`
          : `Reconstruction quality "${assessment.status}" for "${options.tag}": insufficient evidence to build an M40 candidate.`) + existingReleaseNote,
    exitCode: finalMapping.exitCode,
    blockingIssues: [...m40Findings, ...readinessFindings],
    warnings,
    data: { assessment, decision, existingRelease, retrospectiveNotes },
  });
}
