import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import type { StdinLike } from "../../core/filesystem/stdin.js";
import { assessReleaseCandidate } from "../../services/release-governance-service.js";
import { loadReleaseRequestBody, toReleaseIntentRequest, releaseFailure, blockingFindingToIssue, warningToIssue, mapReadinessIntegrity } from "./release-shared.js";
import { ExitCode } from "../../core/output/exit-codes.js";

/**
 * `aiqt release validate` (build spec Sec 10): read-only readiness/
 * provenance gate -- narrower than `assess` (no risk scoring, no approval
 * authority derivation), used to check candidate/provenance integrity
 * alone.
 */
export interface ReleaseValidateOptions {
  fromFile?: string;
  stdin?: boolean;
}

export async function runReleaseValidate(ctx: CommandContext, options: ReleaseValidateOptions, deps: { stdin?: StdinLike } = {}): Promise<CommandResult> {
  const loaded = await loadReleaseRequestBody(options, deps);
  if (!loaded.ok) return loaded.result;

  const request = toReleaseIntentRequest(ctx.cwd, loaded.body);
  const outcome = assessReleaseCandidate(request);
  if (!outcome.ok) {
    return releaseFailure(
      `Release candidate could not be established: ${outcome.blockingFindings.map((f) => f.message).join("; ")}`,
      ExitCode.InvalidInput,
      "RELEASE-VALIDATE-CANDIDATE-INVALID",
    );
  }

  const { assessment } = outcome;
  const mapping = mapReadinessIntegrity(assessment.readiness.integrity);

  return makeResult({
    status: mapping.status,
    action: "release",
    summary: `Candidate ${assessment.candidate.candidateId}: integrity "${assessment.readiness.integrity}" (${assessment.readiness.blockingFindings.length} blocking, ${assessment.readiness.warnings.length} warning).`,
    exitCode: mapping.exitCode,
    blockingIssues: assessment.readiness.blockingFindings.map(blockingFindingToIssue),
    warnings: assessment.readiness.warnings.map(warningToIssue),
    data: { candidate: assessment.candidate, provenance: assessment.provenance, readiness: assessment.readiness },
  });
}
