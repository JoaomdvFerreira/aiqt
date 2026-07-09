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

export const ReviewFindingSchema = z.object({
  id: z.string(),
  category: ReviewFindingCategorySchema,
  severity: ReviewFindingSeveritySchema,
  blocking: z.boolean(),
  title: z.string(),
  message: z.string(),
  relatedIds: z.array(z.string()),
  suggestedAction: z.string(),
  nextRecommendedCommand: z.string().nullable(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
