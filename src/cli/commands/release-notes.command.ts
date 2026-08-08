import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import type { StdinLike } from "../../core/filesystem/stdin.js";
import { assessReleaseDecision } from "../../services/release-governance-service.js";
import { loadReleaseRequestBody, toReleaseIntentRequest, releaseFailure, mapReadinessIntegrity } from "./release-shared.js";
import { renderReleaseNotesMarkdown, type ReadyReleaseDecision } from "../../workflow/release-notes.js";
import { ExitCode } from "../../core/output/exit-codes.js";

/**
 * `aiqt release notes` (build spec Sec 9, 10): renders deterministic
 * release notes from the same candidate/evidence snapshot `assess` uses.
 * Human and JSON outputs carry the same underlying decision -- the
 * markdown in `data.notes` is a rendering of `data.decision`, never a
 * separate source of truth.
 */
export interface ReleaseNotesOptions {
  fromFile?: string;
  stdin?: boolean;
}

export async function runReleaseNotes(ctx: CommandContext, options: ReleaseNotesOptions, deps: { stdin?: StdinLike } = {}): Promise<CommandResult> {
  const loaded = await loadReleaseRequestBody(options, deps);
  if (!loaded.ok) return loaded.result;

  const request = toReleaseIntentRequest(ctx.cwd, loaded.body);
  const outcome = assessReleaseDecision(request);
  if (!outcome.ok) {
    return releaseFailure(
      `Release candidate could not be established: ${outcome.blockingFindings.map((f) => f.message).join("; ")}`,
      ExitCode.InvalidInput,
      "RELEASE-NOTES-CANDIDATE-INVALID",
    );
  }

  const { decision } = outcome;
  const mapping = mapReadinessIntegrity(decision.readiness.integrity);
  const ready: ReadyReleaseDecision = { ...decision, risk: decision.risk!, approval: decision.approval! };
  const notes = renderReleaseNotesMarkdown(ready);

  return makeResult({
    status: mapping.status,
    action: "release",
    summary: `Rendered release notes for candidate ${decision.candidate.candidateId} (risk ${decision.risk?.totalScore}/100, ${decision.risk?.status}).`,
    exitCode: mapping.exitCode,
    data: { notes, decision },
  });
}
