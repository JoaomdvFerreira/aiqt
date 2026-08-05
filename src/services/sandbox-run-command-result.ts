import type { SandboxEvidence } from "../schema/sandbox-backend.schema.js";
import { makeResult, type CommandResult, type CommandStatus } from "../core/output/result.js";
import { ExitCode } from "../core/output/exit-codes.js";

/**
 * M38-WU04 (build spec acceptance criterion: "M33 result contract
 * preserved"). Wraps a SandboxEvidence (M38-WU01/WU03) in an M33
 * CommandResult -- the same envelope every other AIQT command output
 * uses -- mirroring `autonomous-run-command-result.ts`'s
 * `buildAutonomousRunCommandResult` exactly, adapted for the sandbox
 * evidence shape instead of the bare-worktree AutonomousEvidencePacket
 * shape.
 */
export type SandboxRunResultState = "passed" | "validation_failed" | "review_rejected" | "blocked" | "cancelled" | "budget_exhausted" | "failed";

const RESULT_STATE_STATUS: Readonly<Record<SandboxRunResultState, CommandStatus>> = {
  passed: "passed",
  failed: "failed",
  blocked: "blocked",
  cancelled: "blocked",
  budget_exhausted: "blocked",
  validation_failed: "failed",
  review_rejected: "failed",
};

const RESULT_STATE_EXIT_CODE: Readonly<Record<SandboxRunResultState, number>> = {
  passed: ExitCode.Success,
  failed: ExitCode.ValidationFailed,
  blocked: ExitCode.WorkflowBlocked,
  cancelled: ExitCode.WorkflowBlocked,
  budget_exhausted: ExitCode.WorkflowBlocked,
  validation_failed: ExitCode.ValidationFailed,
  review_rejected: ExitCode.ValidationFailed,
};

export function buildSandboxRunCommandResult(runId: string, issueId: string, resultState: SandboxRunResultState, findings: readonly string[], evidence: SandboxEvidence): CommandResult<SandboxEvidence> {
  const status = RESULT_STATE_STATUS[resultState];
  const exitCode = RESULT_STATE_EXIT_CODE[resultState];

  return makeResult<SandboxEvidence>({
    status,
    action: "autonomous",
    summary: `Live sandboxed run ${runId} for issue "${issueId}" finished with result state "${resultState}": ${evidence.residualRisk}`,
    exitCode,
    completedActions: evidence.commandsExecuted,
    changedFiles: evidence.filesChanged,
    requiresHumanInput: false,
    nextRecommendedCommand: null,
    warnings: findings.map((finding, index) => ({
      id: `SANDBOX-RUN-FINDING-${index + 1}`,
      severity: "medium",
      area: "sandbox-run",
      message: finding,
      agentCanFix: false,
    })),
    data: evidence,
  });
}
