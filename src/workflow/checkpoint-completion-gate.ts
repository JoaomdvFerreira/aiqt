import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type {
  CheckpointInput,
  CheckpointIssueInput,
} from "../schema/checkpoint-input.schema.js";
import type {
  AcceptanceCriterionResult,
  AcceptanceCriteriaResult,
  CheckpointIssue,
  FinalWorkUnitStatus,
  ValidationCommandResult,
  ValidationResult,
} from "../schema/checkpoint.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";

type CompletionIssue = CheckpointIssueInput | CheckpointIssue;

export interface CompletionEvaluationInput {
  workUnit: Pick<WorkUnit, "validationCommands" | "acceptanceCriteria">;
  validationResult: ValidationResult;
  acceptanceCriteriaResult: AcceptanceCriteriaResult;
  notCompleted: readonly string[];
  issues: readonly CompletionIssue[];
  validationCommands: readonly ValidationCommandResult[];
  acceptanceCriteria: readonly AcceptanceCriterionResult[];
}

export interface CompletionEvaluation {
  complete: boolean;
  reasons: string[];
}

function hasOpenHighOrCriticalIssue(issues: readonly CompletionIssue[]): boolean {
  return issues.some(
    (issue) =>
      (issue.status ?? "open") === "open" &&
      (issue.severity === "high" || issue.severity === "critical"),
  );
}

function hasRequiredResult<T extends { result: string }>(
  required: readonly string[],
  reported: readonly T[],
  identity: (entry: T) => string,
  label: string,
  reasons: string[],
): void {
  for (const requiredItem of required) {
    const result = reported.find((entry) => identity(entry) === requiredItem);
    if (!result) {
      reasons.push(`required ${label} "${requiredItem}" is not assessed`);
    } else if (result.result !== "passed") {
      reasons.push(`required ${label} "${requiredItem}" is ${result.result}`);
    }
  }
}

/**
 * The single implementation-completion predicate for both terminal
 * checkpoints and needs_review -> done amendment promotion. It intentionally
 * evaluates only persisted implementation facts: a passed aggregate never
 * overrides unfinished work, blocking issues, or a missing/failed required
 * detailed result. Authority decisions are evaluated by their existing
 * separate gate and never rewrite these technical outcomes.
 */
export function evaluateImplementationCompletion(
  input: CompletionEvaluationInput,
): CompletionEvaluation {
  const reasons: string[] = [];
  if (input.validationResult !== "passed") reasons.push(`validationResult is ${input.validationResult}`);
  if (input.acceptanceCriteriaResult !== "passed") reasons.push(`acceptanceCriteriaResult is ${input.acceptanceCriteriaResult}`);
  if (input.notCompleted.length > 0) reasons.push("unfinished work is recorded");
  if (hasOpenHighOrCriticalIssue(input.issues)) reasons.push("an open high/critical issue exists");
  hasRequiredResult(input.workUnit.validationCommands, input.validationCommands, (entry) => entry.command, "validation command", reasons);
  hasRequiredResult(input.workUnit.acceptanceCriteria, input.acceptanceCriteria, (entry) => entry.criterion, "acceptance criterion", reasons);
  return { complete: reasons.length === 0, reasons };
}

function evaluateCheckpointInput(workUnit: CompletionEvaluationInput["workUnit"], input: CheckpointInput): CompletionEvaluation {
  return evaluateImplementationCompletion({
    workUnit,
    validationResult: input.validationResult,
    acceptanceCriteriaResult: input.acceptanceCriteriaResult,
    notCompleted: input.notCompleted,
    issues: input.issues,
    validationCommands: input.validationCommands.map((entry) => ({ ...entry, summary: entry.summary ?? null })),
    acceptanceCriteria: input.acceptanceCriteria.map((entry) => ({ ...entry, evidence: entry.evidence ?? null })),
  });
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
  workUnit: CompletionEvaluationInput["workUnit"],
  input: CheckpointInput,
): FinalWorkUnitStatus {
  const evaluation = evaluateCheckpointInput(workUnit, input);
  if (input.targetStatus === undefined) {
    return evaluation.complete ? "done" : "needs_review";
  }

  if (input.targetStatus === "needs_review") {
    return "needs_review";
  }

  if (!evaluation.complete) {
    throw completionGateError(`Checkpoint targetStatus is done but ${evaluation.reasons[0]}.`);
  }
  return "done";
}
