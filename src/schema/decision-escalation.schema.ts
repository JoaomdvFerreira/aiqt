import { z } from "zod";

/**
 * M22-WU02: identity-only foundation. Extended with category, question,
 * rationale, and resolution fields in WU22-05. A DecisionEscalation is
 * never a severity or fixability label and never automatically blocks
 * workflow in M22.
 */
export const DecisionEscalationSchema = z.object({
  escalationId: z.string().min(1),
  escalationKey: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DecisionEscalation = z.infer<typeof DecisionEscalationSchema>;
