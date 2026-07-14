import { z } from "zod";

/**
 * M9 §7.2: an additive, backward-compatible state extension. Existing state
 * files without `review` remain valid -- missing review.acknowledgedFindings
 * must be treated as an empty array (see getAcknowledgedFindings in
 * manage-service.ts). Does not require an AIQT_SCHEMA_VERSION bump.
 */
export const AcknowledgedFindingSchema = z.object({
  findingKey: z.string().min(1),
  reason: z.string().min(1),
  acknowledgedAt: z.string(),
  sourceCommand: z.string(),
});
export type AcknowledgedFinding = z.infer<typeof AcknowledgedFindingSchema>;

export const ReviewAcknowledgmentStateSchema = z.object({
  acknowledgedFindings: z.array(AcknowledgedFindingSchema),
});
export type ReviewAcknowledgmentState = z.infer<
  typeof ReviewAcknowledgmentStateSchema
>;
