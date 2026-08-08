import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { reconstructHistoricalRelease } from "../../services/historical-reconstruction-service.js";
import { releaseFailure, blockingFindingToIssue, warningToIssue, mapReadinessIntegrity } from "./release-shared.js";
import type { ReconstructionStatus } from "../../schema/historical-reconstruction.schema.js";

/**
 * `aiqt release reconstruct <tag>` (M44-WU03, build spec Sec 4.1): explicit-
 * target, read-only reconstruction and assessment. Never publishes, drafts,
 * tags, merges, or mutates -- reconstructs a bounded evidence ledger for the
 * one requested tag and, when sufficiently evidenced, maps it into the
 * existing M40 candidate/provenance/readiness/risk/approval/notes flow
 * (M44-WU02's buildHistoricalReleaseTarget + this command's own status/M40
 * mapping via historical-reconstruction-service.ts).
 */
export interface ReleaseReconstructOptions {
  tag: string;
  repository: string;
}

const STATUS_EXIT: Record<ReconstructionStatus, { status: "passed" | "warning" | "failed" | "blocked"; exitCode: number }> = {
  existing_release: { status: "passed", exitCode: ExitCode.Success },
  reconstructable: { status: "passed", exitCode: ExitCode.Success },
  reconstructable_with_warnings: { status: "warning", exitCode: ExitCode.Success },
  partial: { status: "warning", exitCode: ExitCode.Success },
  conflicting: { status: "blocked", exitCode: ExitCode.WorkflowBlocked },
  insufficient_evidence: { status: "failed", exitCode: ExitCode.ValidationFailed },
};

export function runReleaseReconstruct(ctx: CommandContext, options: ReleaseReconstructOptions): CommandResult {
  if (!options.repository.trim()) {
    return releaseFailure("Provide --repository <identity> to identify the reconstructed candidate's repository.", ExitCode.InvalidInput, "RELEASE-RECONSTRUCT-MISSING-REPOSITORY");
  }

  const outcome = reconstructHistoricalRelease(ctx.cwd, options.repository, options.tag);
  if (!outcome.ok) {
    return releaseFailure(`Release tag "${options.tag}" was not found in this repository.`, ExitCode.InvalidInput, "RELEASE-RECONSTRUCT-TAG-NOT-FOUND");
  }

  const { assessment, decision, m40BlockingFindings, retrospectiveNotes } = outcome.result;
  const mapping = STATUS_EXIT[assessment.status];

  const m40Findings = m40BlockingFindings.map((f) => blockingFindingToIssue(f));
  const readinessFindings = decision ? decision.readiness.blockingFindings.map(blockingFindingToIssue) : [];
  const warnings = decision ? decision.readiness.warnings.map(warningToIssue) : [];

  // A decision means M40 itself already assessed readiness -- that mapping
  // is authoritative over the coarser reconstruction-quality mapping
  // (M40 remains the sole readiness/risk/approval-authority owner, build
  // spec Sec 9). Reconstruction's own mapping applies only when no M40
  // decision could be built at all (conflicting/insufficient evidence, or
  // M40's own candidate-identity checks failed).
  const readinessMapping = decision && m40BlockingFindings.length === 0 ? mapReadinessIntegrity(decision.readiness.integrity) : null;
  const finalMapping = readinessMapping ?? mapping;

  return makeResult({
    status: finalMapping.status,
    action: "release",
    summary:
      m40BlockingFindings.length > 0
        ? `Reconstruction quality "${assessment.status}" for "${options.tag}", but M40 candidate assembly failed: ${m40BlockingFindings.map((f) => f.message).join("; ")}`
        : decision
          ? `Reconstruction quality "${assessment.status}" for "${options.tag}": candidate integrity "${decision.readiness.integrity}", risk ${decision.risk?.totalScore ?? "n/a"}/100.`
          : `Reconstruction quality "${assessment.status}" for "${options.tag}": insufficient evidence to build an M40 candidate.`,
    exitCode: finalMapping.exitCode,
    blockingIssues: [...m40Findings, ...readinessFindings],
    warnings,
    data: { assessment, decision, retrospectiveNotes },
  });
}
