import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type {
  CheckpointInput,
  CheckpointIssueInput,
} from "../schema/checkpoint-input.schema.js";
import type { FinalWorkUnitStatus } from "../schema/checkpoint.schema.js";

function hasOpenHighOrCriticalIssue(issues: readonly CheckpointIssueInput[]): boolean {
  return issues.some(
    (issue) =>
      (issue.status ?? "open") === "open" &&
      (issue.severity === "high" || issue.severity === "critical"),
  );
}

function meetsCompletionConditions(input: CheckpointInput): boolean {
  return (
    input.validationResult === "passed" &&
    input.acceptanceCriteriaResult === "passed" &&
    input.notCompleted.length === 0 &&
    !hasOpenHighOrCriticalIssue(input.issues)
  );
}

function completionGateError(message: string): AiqtError {
  return new AiqtError(message, ExitCode.ValidationFailed, {
    id: "CHECKPOINT-COMPLETION-GATE-FAILED",
    severity: "high",
    area: "checkpoint",
    message,
    suggestedAction: "Correct the checkpoint input and rerun aiqt checkpoint.",
    agentCanFix: false,
  });
}

/**
 * Derive (when targetStatus is omitted) or validate (when targetStatus is
 * supplied) the final work unit status from a checkpoint input. Throws
 * AiqtError (exit code 1) when an explicit targetStatus = "done" claim does
 * not pass the completion gate. targetStatus = "needs_review" is always
 * allowed; M5 does not mark work done unless the result is explicitly
 * acceptable.
 */
export function deriveFinalWorkUnitStatus(
  input: CheckpointInput,
): FinalWorkUnitStatus {
  if (input.targetStatus === undefined) {
    return meetsCompletionConditions(input) ? "done" : "needs_review";
  }

  if (input.targetStatus === "needs_review") {
    return "needs_review";
  }

  // input.targetStatus === "done": must pass the completion gate exactly.
  if (input.validationResult !== "passed") {
    throw completionGateError(
      "Checkpoint targetStatus is done but validationResult is not passed.",
    );
  }
  if (input.acceptanceCriteriaResult !== "passed") {
    throw completionGateError(
      "Checkpoint targetStatus is done but acceptanceCriteriaResult is not passed.",
    );
  }
  if (input.notCompleted.length > 0) {
    throw completionGateError(
      "Checkpoint targetStatus is done but notCompleted has one or more items.",
    );
  }
  if (hasOpenHighOrCriticalIssue(input.issues)) {
    throw completionGateError(
      "Checkpoint targetStatus is done but an open high/critical issue exists.",
    );
  }
  return "done";
}
