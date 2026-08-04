import { makeResult, type CommandResult } from "../core/output/result.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type { ImportAgentResponseResult, ImportAgentResponseFailureReason } from "./autonomous-agent-response-import-service.js";

/**
 * M37-WU02 (build spec acceptance criterion: "provider errors map to M33
 * contract"). Wraps an ImportAgentResponseResult in an M33 CommandResult
 * -- the same envelope every other AIQT command output uses -- WITHOUT
 * adding a new CLI command surface (wiring is WU37-03's "invoke adapter"
 * scope, not this Work Unit's). Mirrors autonomous-run-command-result.ts's
 * shape exactly.
 */
const FAILURE_EXIT_CODE: Readonly<Record<ImportAgentResponseFailureReason, number>> = {
  request_expired: ExitCode.WorkflowBlocked,
  request_not_pending: ExitCode.WorkflowBlocked,
  malformed_response: ExitCode.InvalidInput,
  request_id_mismatch: ExitCode.InvalidInput,
  provider_id_mismatch: ExitCode.InvalidInput,
};

const FAILURE_ISSUE_ID: Readonly<Record<ImportAgentResponseFailureReason, string>> = {
  request_expired: "AUTONOMOUS-AGENT-IMPORT-REQUEST-EXPIRED",
  request_not_pending: "AUTONOMOUS-AGENT-IMPORT-REQUEST-NOT-PENDING",
  malformed_response: "AUTONOMOUS-AGENT-IMPORT-MALFORMED-RESPONSE",
  request_id_mismatch: "AUTONOMOUS-AGENT-IMPORT-REQUEST-ID-MISMATCH",
  provider_id_mismatch: "AUTONOMOUS-AGENT-IMPORT-PROVIDER-ID-MISMATCH",
};

export function buildImportAgentResponseCommandResult(result: ImportAgentResponseResult): CommandResult {
  if (!result.ok) {
    return makeResult({
      status: "failed",
      action: "autonomous",
      summary: `Agent response import failed (${result.reason}): ${result.detail}`,
      exitCode: FAILURE_EXIT_CODE[result.reason],
      blockingIssues: [
        {
          id: FAILURE_ISSUE_ID[result.reason],
          severity: "high",
          area: "autonomous-agent-adapter",
          message: result.detail,
          agentCanFix: false,
        },
      ],
    });
  }

  return makeResult({
    status: "passed",
    action: "autonomous",
    summary: `Agent response for request ${result.request.requestId} imported: ${result.response.commandsProposed.length} command(s) proposed.`,
    exitCode: ExitCode.Success,
    data: { requestId: result.request.requestId, commandsProposed: result.response.commandsProposed, notes: result.response.notes ?? null },
  });
}
