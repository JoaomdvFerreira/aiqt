import { z } from "zod";

export const ValidationResultSchema = z.enum([
  "passed",
  "failed",
  "partial",
  "not_run",
]);
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const AcceptanceCriteriaResultSchema = z.enum([
  "passed",
  "failed",
  "partial",
  "not_checked",
]);
export type AcceptanceCriteriaResult = z.infer<
  typeof AcceptanceCriteriaResultSchema
>;

export const ValidationCommandResultSchema = z.object({
  command: z.string(),
  result: ValidationResultSchema,
  summary: z.string().nullable(),
});
export type ValidationCommandResult = z.infer<
  typeof ValidationCommandResultSchema
>;

export const AcceptanceCriterionResultSchema = z.object({
  criterion: z.string(),
  result: AcceptanceCriteriaResultSchema,
  evidence: z.string().nullable(),
});
export type AcceptanceCriterionResult = z.infer<
  typeof AcceptanceCriterionResultSchema
>;

export const CheckpointIssueSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type CheckpointIssueSeverity = z.infer<
  typeof CheckpointIssueSeveritySchema
>;

export const CheckpointIssueStatusSchema = z.enum(["open", "resolved"]);
export type CheckpointIssueStatus = z.infer<typeof CheckpointIssueStatusSchema>;

/**
 * Durable domain record stored inside a checkpoint. Intentionally distinct
 * from the transient CommandResult `Issue` diagnostic contract used for
 * blockingIssues/warnings — the two types must not be merged.
 */
export const CheckpointIssueSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  severity: CheckpointIssueSeveritySchema,
  status: CheckpointIssueStatusSchema,
  agentCanFix: z.boolean(),
});
export type CheckpointIssue = z.infer<typeof CheckpointIssueSchema>;

export const FinalWorkUnitStatusSchema = z.enum(["done", "needs_review"]);
export type FinalWorkUnitStatus = z.infer<typeof FinalWorkUnitStatusSchema>;

/**
 * A checkpoint either records durable progress while its work unit remains
 * active, or records that work unit's terminal disposition.  Keeping this
 * separate from FinalWorkUnitStatus prevents an active status from being
 * misrepresented as a final outcome.
 */
export const CheckpointDispositionSchema = z.enum(["progress", "terminal"]);
export type CheckpointDisposition = z.infer<typeof CheckpointDispositionSchema>;

export const CheckpointSchema = z.object({
  id: z.string(),
  workUnitId: z.string(),
  packetId: z.string().nullable(),
  summary: z.string(),
  completed: z.array(z.string()),
  notCompleted: z.array(z.string()),
  /** Post-handoff evidence requirements; unlike notCompleted these do not describe unfinished implementation. */
  reviewRequirements: z.array(z.string()).optional(),
  filesChanged: z.array(z.string()),
  issues: z.array(CheckpointIssueSchema),
  validationResult: ValidationResultSchema,
  acceptanceCriteriaResult: AcceptanceCriteriaResultSchema,
  validationCommands: z.array(ValidationCommandResultSchema),
  acceptanceCriteria: z.array(AcceptanceCriterionResultSchema),
  /**
   * Null only for a progress checkpoint. Existing terminal checkpoints omit
   * disposition and continue to carry their final status unchanged.
   */
  finalWorkUnitStatus: FinalWorkUnitStatusSchema.nullable(),
  disposition: CheckpointDispositionSchema.optional(),
  nextRecommendation: z.string(),
  createdAt: z.string(),
  /** M26 §5.1: optional, additive. Advisory-only historical reference to this packet's execution sessions; checkpoint never rewrites session history. */
  executionSessionIds: z.array(z.string()).optional(),
}).superRefine((checkpoint, ctx) => {
  const disposition = checkpoint.disposition ?? "terminal";
  if (disposition === "progress" && checkpoint.finalWorkUnitStatus !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finalWorkUnitStatus"], message: "Progress checkpoints must have finalWorkUnitStatus null." });
  }
  if (disposition === "terminal" && checkpoint.finalWorkUnitStatus === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finalWorkUnitStatus"], message: "Terminal checkpoints must have a finalWorkUnitStatus." });
  }
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
