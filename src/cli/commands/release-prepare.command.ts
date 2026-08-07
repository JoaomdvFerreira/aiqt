import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import type { StdinLike } from "../../core/filesystem/stdin.js";
import { assessReleaseDecision } from "../../services/release-governance-service.js";
import { loadReleaseRequestBody, toReleaseIntentRequest, releaseFailure, mapReadinessIntegrity, blockingFindingToIssue, warningToIssue } from "./release-shared.js";
import { resolveReleaseEvidenceDir, saveReleaseDecision } from "../../state/release-decision-store.js";
import { ExitCode } from "../../core/output/exit-codes.js";

/**
 * `aiqt release prepare` (build spec Sec 3, 10): produces bounded LOCAL
 * release evidence/artifacts (the decision JSON and rendered notes) under
 * `.aiqt-release/` (or `--evidence-dir`). Never touches GitHub, never
 * publishes -- this is exactly "local release-evidence preparation", the
 * boundary WU40-04 owns crossing.
 */
export interface ReleasePrepareOptions {
  fromFile?: string;
  stdin?: boolean;
  evidenceDir?: string;
}

export async function runReleasePrepare(ctx: CommandContext, options: ReleasePrepareOptions, deps: { stdin?: StdinLike } = {}): Promise<CommandResult> {
  const loaded = await loadReleaseRequestBody(options, deps);
  if (!loaded.ok) return loaded.result;

  const request = toReleaseIntentRequest(ctx.cwd, loaded.body);
  const outcome = assessReleaseDecision(request);
  if (!outcome.ok) {
    return releaseFailure(
      `Release candidate could not be established: ${outcome.blockingFindings.map((f) => f.message).join("; ")}`,
      ExitCode.InvalidInput,
      "RELEASE-PREPARE-CANDIDATE-INVALID",
    );
  }

  const { decision } = outcome;
  const dir = resolveReleaseEvidenceDir(ctx.cwd, options.evidenceDir);
  const saved = saveReleaseDecision(dir, decision);
  const mapping = mapReadinessIntegrity(decision.readiness.integrity);

  return makeResult({
    status: mapping.status,
    action: "release",
    summary: `Prepared local release evidence for candidate ${decision.candidate.candidateId} at ${dir} (no publication).`,
    exitCode: mapping.exitCode,
    changedFiles: [saved.decisionPath, ...(saved.notesPath ? [saved.notesPath] : [])],
    blockingIssues: decision.readiness.blockingFindings.map(blockingFindingToIssue),
    warnings: decision.readiness.warnings.map(warningToIssue),
    data: { decision, evidenceDir: dir, ...saved },
  });
}
