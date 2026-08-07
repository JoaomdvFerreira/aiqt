import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import type { StdinLike } from "../../core/filesystem/stdin.js";
import { assessReleaseDecision } from "../../services/release-governance-service.js";
import { loadReleaseRequestBody, toReleaseIntentRequest, releaseFailure, blockingFindingToIssue, warningToIssue, mapReadinessIntegrity } from "./release-shared.js";
import { ExitCode } from "../../core/output/exit-codes.js";

/**
 * `aiqt release assess` (build spec Sec 10): read-only evidence/risk
 * assessment. Never creates or mutates any candidate state -- purely
 * computes candidate + provenance + readiness + risk + approval authority
 * from the supplied evidence snapshot and reports it.
 */
export interface ReleaseAssessOptions {
  fromFile?: string;
  stdin?: boolean;
}

export async function runReleaseAssess(ctx: CommandContext, options: ReleaseAssessOptions, deps: { stdin?: StdinLike } = {}): Promise<CommandResult> {
  const loaded = await loadReleaseRequestBody(options, deps);
  if (!loaded.ok) return loaded.result;

  const request = toReleaseIntentRequest(ctx.cwd, loaded.body);
  const outcome = assessReleaseDecision(request);
  if (!outcome.ok) {
    return releaseFailure(
      `Release candidate could not be established: ${outcome.blockingFindings.map((f) => f.message).join("; ")}`,
      ExitCode.InvalidInput,
      "RELEASE-ASSESS-CANDIDATE-INVALID",
    );
  }

  const { decision } = outcome;
  const mapping = mapReadinessIntegrity(decision.readiness.integrity);

  return makeResult({
    status: mapping.status,
    action: "release",
    summary: `Candidate ${decision.candidate.candidateId}: integrity "${decision.readiness.integrity}", risk ${decision.risk?.totalScore ?? "n/a"}/100 (${decision.risk?.status ?? "unknown"}), approval "${decision.approval?.authority ?? "unknown"}".`,
    exitCode: mapping.exitCode,
    blockingIssues: decision.readiness.blockingFindings.map(blockingFindingToIssue),
    warnings: decision.readiness.warnings.map(warningToIssue),
    data: { decision },
  });
}
