import { z } from "zod";

/** M22 §7.4: per-record caps. Not increased without review. */
export const DECISION_ESCALATION_MAX_SERIALIZED_BYTES = 16384;
export const DECISION_ESCALATION_MAX_RELATED_IDS_PER_COLLECTION = 100;
export const DECISION_ESCALATION_MAX_EVIDENCE_REFS = 100;
export const DECISION_ESCALATIONS_HARD_CAP = 5000;

const BOUNDED_MEDIUM = 2000;

export const DecisionEscalationCategorySchema = z.enum([
  "product",
  "architecture",
  "security",
  "legal_compliance",
  "governance",
  "external_setup",
  "other",
]);
export type DecisionEscalationCategory = z.infer<typeof DecisionEscalationCategorySchema>;

/**
 * M22 §5.7: open/resolved/withdrawn only. Not a severity or fixability
 * label, and not the ProjectIssue effective-lifecycle vocabulary --
 * DecisionEscalation and ProjectIssue are deliberately separate concepts
 * with separate, non-overlapping status enums.
 */
export const DecisionEscalationStatusSchema = z.enum(["open", "resolved", "withdrawn"]);
export type DecisionEscalationStatus = z.infer<typeof DecisionEscalationStatusSchema>;

/**
 * M22-WU05: a human decision represented separately from issue severity
 * and fixability. M22 does not automatically block workflow based on an
 * escalation (M22 §5.7/§8) -- that remains a possible future, separately
 * reviewed milestone's decision, never an implicit side effect of this
 * schema existing.
 */
export const DecisionEscalationSchema = z
  .object({
    escalationId: z.string().min(1),
    escalationKey: z.string().min(1),
    category: DecisionEscalationCategorySchema,
    status: DecisionEscalationStatusSchema,
    question: z.string().min(1).max(BOUNDED_MEDIUM),
    rationale: z.string().min(1).max(BOUNDED_MEDIUM),
    relatedWorkUnitIds: z.array(z.string()).max(DECISION_ESCALATION_MAX_RELATED_IDS_PER_COLLECTION),
    relatedMilestoneIds: z.array(z.string()).max(DECISION_ESCALATION_MAX_RELATED_IDS_PER_COLLECTION),
    evidenceIds: z.array(z.string()).max(DECISION_ESCALATION_MAX_EVIDENCE_REFS),
    resolution: z
      .object({
        answer: z.string().max(BOUNDED_MEDIUM).optional(),
        resolvedAt: z.string().optional(),
        resolvedBy: z.string().optional(),
      })
      .nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > DECISION_ESCALATION_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `DecisionEscalation exceeds max_serialized_bytes (${DECISION_ESCALATION_MAX_SERIALIZED_BYTES})`,
      });
    }
  });
export type DecisionEscalation = z.infer<typeof DecisionEscalationSchema>;
