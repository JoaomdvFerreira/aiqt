import type { AutonomousEvidencePacket, AutonomousResultState } from "../schema/autonomous-run.schema.js";
import { makeResult, type CommandResult, type CommandStatus } from "../core/output/result.js";
import { ExitCode } from "../core/output/exit-codes.js";

/**
 * M36-WU04 (build spec acceptance criterion: "packet follows the M33
 * machine contract"). Wraps an AutonomousEvidencePacket (WU36-01/WU36-04)
 * in an M33 CommandResult -- the same envelope every other AIQT command
 * output uses -- WITHOUT adding a new CLI command surface. This function
 * is not wired into src/cli/commands/* by this Work Unit; it exists so a
 * future operator-facing command (WU36-05 or later) can present a run's
 * evidence packet through the existing, already-documented JSON contract
 * instead of inventing a second output shape.
 */
const RESULT_STATE_STATUS: Readonly<Record<AutonomousResultState, CommandStatus>> = {
  passed: "passed",
  failed: "failed",
  blocked: "blocked",
  needs_input: "needs_input",
  cancelled: "blocked",
  budget_exhausted: "blocked",
  validation_failed: "failed",
  review_rejected: "failed",
};

const RESULT_STATE_EXIT_CODE: Readonly<Record<AutonomousResultState, number>> = {
  passed: ExitCode.Success,
  failed: ExitCode.ValidationFailed,
  blocked: ExitCode.WorkflowBlocked,
  needs_input: ExitCode.HumanInputRequired,
  cancelled: ExitCode.WorkflowBlocked,
  budget_exhausted: ExitCode.WorkflowBlocked,
  validation_failed: ExitCode.ValidationFailed,
  review_rejected: ExitCode.ValidationFailed,
};

export function buildAutonomousRunCommandResult(packet: AutonomousEvidencePacket): CommandResult<AutonomousEvidencePacket> {
  const status = RESULT_STATE_STATUS[packet.resultState];
  const exitCode = RESULT_STATE_EXIT_CODE[packet.resultState];

  return makeResult<AutonomousEvidencePacket>({
    status,
    action: "autonomous",
    summary: `Autonomous run ${packet.runId} for issue "${packet.candidate.issueId}" finished with result state "${packet.resultState}": ${packet.residualRisk}`,
    exitCode,
    completedActions: packet.commandsExecuted,
    changedFiles: packet.filesChanged,
    requiresHumanInput: status === "needs_input",
    nextRecommendedCommand: null,
    warnings: packet.findings.map((finding, index) => ({
      id: `AUTONOMOUS-RUN-FINDING-${index + 1}`,
      severity: "medium",
      area: "autonomous-run",
      message: finding,
      agentCanFix: false,
    })),
    data: packet,
  });
}
