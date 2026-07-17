import { z } from "zod";

export const ReviewFindingCategorySchema = z.enum([
  "state",
  "workflow",
  "context",
  "graph",
  "integrity",
  "checkpoint",
  "quality",
  "export",
]);
export type ReviewFindingCategory = z.infer<typeof ReviewFindingCategorySchema>;

export const ReviewFindingSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type ReviewFindingSeverity = z.infer<typeof ReviewFindingSeveritySchema>;

/**
 * M18 §10: optional structured detail attached to a WORK_UNIT_STALE_READINESS
 * finding -- a work unit whose canonical status is "ready" but whose active
 * blocking/requires dependencies are not (yet, or no longer) satisfied.
 * Additive only; absent on every other finding type.
 */
export const StaleReadinessDetailsSchema = z.object({
  workUnitId: z.string(),
  canonicalStatus: z.string(),
  expectedStatus: z.literal("planned"),
  unsatisfiedDependencyIds: z.array(z.string()),
  blockingPredecessorWorkUnitIds: z.array(z.string()),
  dependencyTypes: z.array(z.enum(["blocks", "requires"])),
  repairable: z.boolean(),
});
export type StaleReadinessDetails = z.infer<typeof StaleReadinessDetailsSchema>;

export const ReviewFindingSchema = z.object({
  id: z.string(),
  /**
   * M9 §7.3: stable, deterministic identity for acknowledgment, derived from
   * canonical state fields (e.g. "checkpoint:WU003:acceptanceCriteriaResult:partial").
   * Distinct from `id` (an ephemeral FIND-### display id recomputed every run).
   */
  findingKey: z.string(),
  category: ReviewFindingCategorySchema,
  severity: ReviewFindingSeveritySchema,
  blocking: z.boolean(),
  title: z.string(),
  message: z.string(),
  relatedIds: z.array(z.string()),
  suggestedAction: z.string(),
  nextRecommendedCommand: z.string().nullable(),
  /** M18 §10: present only on WORK_UNIT_STALE_READINESS findings. */
  staleReadinessDetails: StaleReadinessDetailsSchema.optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
