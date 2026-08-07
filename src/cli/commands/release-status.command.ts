import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { resolveReleaseEvidenceDir, listReleaseCandidateIds, loadReleaseDecision } from "../../state/release-decision-store.js";
import { releaseFailure, mapReadinessIntegrity, blockingFindingToIssue, warningToIssue } from "./release-shared.js";

/**
 * `aiqt release status` (build spec Sec 10): read-only report of prepared
 * candidate/draft readiness. Lists every locally-prepared candidate id
 * when `--candidate` is omitted, or reports one candidate's full decision
 * (including its still-`not_created`-unless-WU40-04-ran draft state) when
 * given. No mutation, no network -- reads only what `release prepare`
 * already wrote locally.
 */
export interface ReleaseStatusOptions {
  candidate?: string;
  evidenceDir?: string;
}

export function runReleaseStatus(ctx: CommandContext, options: ReleaseStatusOptions): CommandResult {
  const dir = resolveReleaseEvidenceDir(ctx.cwd, options.evidenceDir);

  if (!options.candidate) {
    const candidateIds = listReleaseCandidateIds(dir);
    return makeResult({
      status: "passed",
      action: "release",
      summary: candidateIds.length === 0 ? `No prepared release candidates found in ${dir}.` : `${candidateIds.length} prepared release candidate(s) found in ${dir}.`,
      exitCode: ExitCode.Success,
      data: { evidenceDir: dir, candidateIds },
    });
  }

  const loaded = loadReleaseDecision(dir, options.candidate);
  if (!loaded.ok) {
    return releaseFailure(loaded.reason, ExitCode.InvalidInput, "RELEASE-STATUS-CANDIDATE-NOT-FOUND");
  }

  const { decision } = loaded;
  const mapping = mapReadinessIntegrity(decision.readiness.integrity);

  return makeResult({
    status: mapping.status,
    action: "release",
    summary: `Candidate ${decision.candidate.candidateId}: integrity "${decision.readiness.integrity}", draft "${decision.draft.status}".`,
    exitCode: mapping.exitCode,
    blockingIssues: decision.readiness.blockingFindings.map(blockingFindingToIssue),
    warnings: decision.readiness.warnings.map(warningToIssue),
    data: { decision, evidenceDir: dir },
  });
}
