import type { Checkpoint, AcceptanceCriterionResult, CheckpointIssue, ValidationCommandResult, AcceptanceCriteriaResult, ValidationResult } from "../schema/checkpoint.schema.js";
import type { ReviewDecision } from "../schema/review-record.schema.js";
import type { StateModel } from "../schema/state.schema.js";

export interface EffectiveReviewState {
  checkpointId: string; acceptanceCriteriaResult: AcceptanceCriteriaResult; validationResult: ValidationResult;
  implementationNotCompleted: string[]; reviewRequirements: string[]; acceptanceCriteria: AcceptanceCriterionResult[];
  validationCommands: ValidationCommandResult[]; issues: CheckpointIssue[]; decision: ReviewDecision | null;
  recordIds: string[];
}

/** The only projection used for post-handoff review facts. Checkpoints stay immutable. */
export function computeEffectiveReviewState(checkpoint: Checkpoint, state: Pick<StateModel, "reviewRecords" | "checkpointAmendments">): EffectiveReviewState {
  let acceptanceCriteriaResult = checkpoint.acceptanceCriteriaResult;
  let validationResult = checkpoint.validationResult;
  const implementationNotCompleted = [...checkpoint.notCompleted];
  const reviewRequirements = [...(checkpoint.reviewRequirements ?? [])];
  const acceptanceCriteria = checkpoint.acceptanceCriteria.map((x) => ({ ...x }));
  const validationCommands = checkpoint.validationCommands.map((x) => ({ ...x }));
  const issues = checkpoint.issues.map((x) => ({ ...x }));
  let decision: ReviewDecision | null = null;
  const recordIds: string[] = [];
  // Legacy amendment history is deterministically translated, without a state rewrite.
  for (const a of (state.checkpointAmendments ?? []).filter((x) => x.checkpointId === checkpoint.id)) {
    recordIds.push(a.amendmentId);
    if (a.acceptanceCriteriaResult !== undefined) acceptanceCriteriaResult = a.acceptanceCriteriaResult;
    if (a.validationResult !== undefined) validationResult = a.validationResult;
    if (a.resolvedNotCompleted !== undefined) { const i = implementationNotCompleted.indexOf(a.resolvedNotCompleted); if (i >= 0) implementationNotCompleted.splice(i, 1); }
    if (a.reconciledAcceptanceCriterion) { const item = acceptanceCriteria.find((x) => x.criterion === a.reconciledAcceptanceCriterion!.criterion); if (item) { item.result = a.reconciledAcceptanceCriterion.result; if (a.reconciledAcceptanceCriterion.evidenceReference !== undefined) item.evidence = a.reconciledAcceptanceCriterion.evidenceReference; } }
  }
  // Old passed/passed amendments were the supported acceptance action. Project
  // the final legacy result, rather than retaining an earlier acceptance.
  if (
    (state.checkpointAmendments ?? []).some((x) => x.checkpointId === checkpoint.id) &&
    acceptanceCriteriaResult === "passed" &&
    validationResult === "passed"
  ) decision = "accepted";
  for (const r of (state.reviewRecords ?? []).filter((x) => x.checkpointId === checkpoint.id)) {
    recordIds.push(r.reviewId);
    if (r.acceptanceCriteriaResult !== undefined) acceptanceCriteriaResult = r.acceptanceCriteriaResult;
    if (r.validationResult !== undefined) validationResult = r.validationResult;
    if (r.decision !== undefined) decision = r.decision;
    for (const requirement of r.resolvedReviewRequirements) { const i = reviewRequirements.indexOf(requirement); if (i >= 0) reviewRequirements.splice(i, 1); }
    for (const update of r.acceptanceCriteria) { const item = acceptanceCriteria.find((x) => x.criterion === update.criterion); if (item) { item.result = update.result; if (update.evidence !== undefined) item.evidence = update.evidence; } }
    for (const update of r.validationCommands) { const item = validationCommands.find((x) => x.command === update.command); if (item) { item.result = update.result; if (update.summary !== undefined) item.summary = update.summary; } }
    for (const update of r.issues) { const item = issues.find((x) => x.title === update.title); if (item) item.status = update.status; }
  }
  return { checkpointId: checkpoint.id, acceptanceCriteriaResult, validationResult, implementationNotCompleted, reviewRequirements, acceptanceCriteria, validationCommands, issues, decision, recordIds };
}
