import { z } from "zod";

/**
 * M11 §8: an additive, backward-compatible state extension. Existing state
 * files without `issues` remain valid -- missing issues.overrides and
 * issues.promotions must be treated as empty arrays (see getIssueOverrides
 * and getIssuePromotions in issue-service.ts). Does not require an
 * AIQT_SCHEMA_VERSION bump.
 */
export const IssueOverrideStatusSchema = z.enum([
  "active",
  "accepted",
  "deferred",
  "resolved",
  "post_mvp",
]);
export type IssueOverrideStatus = z.infer<typeof IssueOverrideStatusSchema>;

export const IssueOverrideSchema = z.object({
  issueKey: z.string().min(1),
  status: IssueOverrideStatusSchema,
  reason: z.string().min(1),
  updatedAt: z.string(),
  sourceCommand: z.string(),
});
export type IssueOverride = z.infer<typeof IssueOverrideSchema>;

export const IssuePromotionSchema = z.object({
  issueKey: z.string().min(1),
  workUnitId: z.string().min(1),
  milestoneId: z.string().min(1),
  promotedAt: z.string(),
  sourceCommand: z.string(),
});
export type IssuePromotion = z.infer<typeof IssuePromotionSchema>;

export const IssueStateSchema = z.object({
  overrides: z.array(IssueOverrideSchema),
  promotions: z.array(IssuePromotionSchema),
});
export type IssueState = z.infer<typeof IssueStateSchema>;
