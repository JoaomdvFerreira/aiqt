import type { AutonomousCandidate, AutonomousSafetyAssessment, AutonomousEvidencePacket } from "../schema/autonomous-run.schema.js";

/**
 * M37-WU01 (build spec: "autonomous run must not invoke a real coding
 * agent in WU37-01... simulation-only implementation... do not imply
 * that a real agent ran"). Produces a preview-only AutonomousEvidencePacket
 * with NO real I/O whatsoever -- no worktree creation, no command
 * execution, no model invocation, not even a call into M36's own
 * `produceAutonomousEvidencePacket`/`executeAutonomousRun` (which DO
 * create a real `git worktree`; calling either from this Work Unit would
 * violate the explicit "do not create a real autonomous worktree"
 * operating constraint). This function is the ENTIRE "autonomous run"
 * surface available in WU37-01 -- verified by
 * tests/unit/autonomous-run-boundary-scan.test.ts's WU37-01 section,
 * which asserts the real M36 execution pipeline is never imported by any
 * CLI command file.
 *
 * Always returns `resultState: "needs_input"` -- a simulated run can
 * never legitimately claim `"passed"` (no real validation ever ran, and
 * M36-WU04's "no pass without validation" invariant applies here too,
 * even though this path never touches the real validation service) --
 * and the packet's own `findings` state plainly, in the first entry,
 * that this was a simulation.
 */
export function simulateAutonomousRun(params: {
  runId: string;
  candidate: AutonomousCandidate;
  safetyAssessment: AutonomousSafetyAssessment;
}): AutonomousEvidencePacket {
  return {
    runId: params.runId,
    candidate: params.candidate,
    safetyAssessment: params.safetyAssessment,
    commandsExecuted: [],
    filesChanged: [],
    findings: [
      "SIMULATED RUN: no coding agent was invoked, no worktree was created, and the target repository was not modified. This output previews the evidence-packet shape only and must not be treated as a real result.",
    ],
    residualRisk: "Not assessed -- this run performed no real execution, so no real residual risk exists to report.",
    resultState: "needs_input",
    recommendedHumanAction: "provide_missing_input",
  };
}
