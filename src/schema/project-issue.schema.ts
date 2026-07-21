import { z } from "zod";

/**
 * M22-WU02: identity-only foundation. Extended with classification,
 * provenance, and relationship fields in WU22-03. `ProjectIssue` is
 * deliberately NOT a second mutable issue lifecycle -- it never gains a
 * `status`/acknowledgment/deferment/resolution/post-mvp/promotion field.
 * The existing IssueOverride/IssuePromotion services (keyed by the same
 * canonical `issueKey`) remain the sole authoritative lifecycle owner; see
 * src/services/issue-service.ts.
 */
export const ProjectIssueSchema = z.object({
  projectIssueId: z.string().min(1),
  issueKey: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectIssue = z.infer<typeof ProjectIssueSchema>;

/**
 * M22-WU02: identity-only foundation for the explicit, append-only
 * CheckpointIssue -> ProjectIssue transition record. Extended with reason
 * and evidence linkage in WU22-03.
 */
export const ProjectIssueTransitionSchema = z.object({
  transitionId: z.string().min(1),
  issueKey: z.string().min(1),
  createdAt: z.string(),
});
export type ProjectIssueTransition = z.infer<typeof ProjectIssueTransitionSchema>;
