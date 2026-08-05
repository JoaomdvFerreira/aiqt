/**
 * M38-WU04 (build spec: "self-review"; Sec 2 pipeline: "... -> self-
 * review -> evidence packet -> human integration decision"). A pure
 * evaluator, mirroring M36-WU04's `reviewAutonomousRun`
 * (autonomous-run-self-review.ts) shape exactly -- consumes already-
 * collected evidence, produces findings, performs no I/O of its own.
 *
 * Deliberately narrower than M36's own self-review: a live sandboxed
 * run's only cheaply, honestly available real signal (as of WU38-04)
 * is the `git status --porcelain`-derived changed-file NAME list
 * (`DockerSandboxBackend.exportEvidence`'s `filesChanged`) -- there is
 * no real diff-line-count or unexpected-file-outside-scope detection
 * for sandboxed runs yet (that would require a real `git diff
 * --numstat` equivalent run inside the sandbox, not built in this Work
 * Unit; recorded as a residual risk in the threat model doc). This
 * function checks the one invariant that IS cheaply available and
 * genuinely meaningful: a run that claims to have completed but
 * changed nothing produced no real repair, exactly M36's own "no
 * files changed" finding.
 */
export interface SandboxSelfReviewInput {
  filesChanged: readonly string[];
}

export interface SandboxSelfReviewResult {
  findings: string[];
  hasUnresolvedCriticalFindings: boolean;
}

export function reviewSandboxRun(input: SandboxSelfReviewInput): SandboxSelfReviewResult {
  const findings: string[] = [];
  if (input.filesChanged.length === 0) {
    findings.push("No files were changed -- the repair attempt produced no diff.");
  }
  return { findings, hasUnresolvedCriticalFindings: findings.length > 0 };
}
