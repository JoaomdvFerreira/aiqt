import { z } from "zod";
import { AcceptanceCriteriaResultSchema, CheckpointIssueStatusSchema, ValidationResultSchema } from "./checkpoint.schema.js";

export const ReviewDecisionSchema = z.enum(["accepted", "rejected", "partial"]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

/** An immutable post-handoff observation or Overseer decision. */
export const ReviewRecordSchema = z.object({
  reviewId: z.string().min(1), checkpointId: z.string().min(1), workUnitId: z.string().min(1),
  decision: ReviewDecisionSchema.optional(),
  acceptanceCriteriaResult: AcceptanceCriteriaResultSchema.optional(), validationResult: ValidationResultSchema.optional(),
  resolvedReviewRequirements: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.object({ criterion: z.string().min(1), result: AcceptanceCriteriaResultSchema, evidence: z.string().min(1).optional() })).default([]),
  validationCommands: z.array(z.object({ command: z.string().min(1), result: ValidationResultSchema, summary: z.string().nullable().optional(), evidence: z.string().min(1).optional() })).default([]),
  issues: z.array(z.object({ title: z.string().min(1), status: CheckpointIssueStatusSchema, evidence: z.string().min(1).optional() })).default([]),
  evidenceReferences: z.array(z.string().min(1)).default([]), reason: z.string().min(1), recordedAt: z.string(), sourceCommand: z.literal("aiqt checkpoint amend"),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;
