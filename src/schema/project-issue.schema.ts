import { z } from "zod";

/** M22 §7.4: per-record and per-collection caps. Not increased without review. */
export const PROJECT_ISSUE_MAX_SERIALIZED_BYTES = 16384;
export const PROJECT_ISSUE_MAX_SOURCE_REFS = 100;
export const PROJECT_ISSUE_MAX_EVIDENCE_REFS = 100;
export const PROJECT_ISSUE_MAX_CHECKPOINT_REFS = 100;
export const PROJECT_ISSUES_HARD_CAP = 5000;
export const PROJECT_ISSUE_TRANSITIONS_HARD_CAP = 5000;

export const ProjectIssueSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type ProjectIssueSeverity = z.infer<typeof ProjectIssueSeveritySchema>;

export const ProjectIssueSourceTypeSchema = z.enum([
  "evidence",
  "checkpoint",
  "review",
  "workspace",
  "provider",
  "manual",
  "system",
]);
export type ProjectIssueSourceType = z.infer<typeof ProjectIssueSourceTypeSchema>;

/**
 * M22-WU03: the durable identity, scope, and provenance record for one
 * project-level canonical condition. Deliberately NOT a second mutable
 * issue lifecycle -- it has no `status`, acknowledgment, deferment,
 * resolution, post-mvp, or promotion field. The existing IssueOverride/
 * IssuePromotion services (src/schema/issue-state.schema.ts,
 * src/services/issue-service.ts), keyed by the same canonical `issueKey`,
 * remain the sole authoritative lifecycle owner (M22 §5.5.1).
 */
export const ProjectIssueSchema = z
  .object({
    projectIssueId: z.string().min(1),
    issueKey: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    severity: ProjectIssueSeveritySchema,
    sourceType: ProjectIssueSourceTypeSchema,
    sourceRefs: z.array(z.string()).max(PROJECT_ISSUE_MAX_SOURCE_REFS),
    affectedWorkUnitIds: z.array(z.string()),
    affectedMilestoneIds: z.array(z.string()),
    evidenceIds: z.array(z.string()).max(PROJECT_ISSUE_MAX_EVIDENCE_REFS),
    checkpointRefs: z.array(z.string()).max(PROJECT_ISSUE_MAX_CHECKPOINT_REFS),
    ownerRef: z.string().nullable(),
    promotionRefs: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > PROJECT_ISSUE_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ProjectIssue exceeds max_serialized_bytes (${PROJECT_ISSUE_MAX_SERIALIZED_BYTES})`,
      });
    }
  });
export type ProjectIssue = z.infer<typeof ProjectIssueSchema>;

export const ProjectIssueTransitionReasonSchema = z.enum([
  "scope_expanded",
  "cross_execution_recurrence",
  "project_tracking_required",
  "release_tracking_required",
  "governance_or_compliance",
  "manual_escalation",
]);
export type ProjectIssueTransitionReason = z.infer<typeof ProjectIssueTransitionReasonSchema>;

/**
 * M22-WU03: explicit, append-only record of a CheckpointIssue expanding
 * scope into a linked ProjectIssue. The original CheckpointIssue is never
 * modified or removed by a transition (M22 §5.6).
 */
export const ProjectIssueTransitionSchema = z.object({
  transitionId: z.string().min(1),
  issueKey: z.string().min(1),
  from: z.object({
    lifecycle: z.literal("checkpoint_issue"),
    checkpointId: z.string().min(1),
    checkpointIssueRef: z.string().min(1),
  }),
  to: z.object({
    lifecycle: z.literal("project_issue"),
    projectIssueId: z.string().min(1),
  }),
  reason: ProjectIssueTransitionReasonSchema,
  evidenceIds: z.array(z.string()),
  createdAt: z.string(),
});
export type ProjectIssueTransition = z.infer<typeof ProjectIssueTransitionSchema>;
