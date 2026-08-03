import { z } from "zod";

export const GuidanceStageSchema = z.enum([
  "not_initialized",
  "needs_context",
  "needs_plan",
  "ready_for_handoff",
  "awaiting_checkpoint",
  "needs_review",
  "ready_for_export",
  "invalid_state",
]);
export type GuidanceStage = z.infer<typeof GuidanceStageSchema>;

export const GuidanceResultDataSchema = z.object({
  stage: GuidanceStageSchema,
  guidance: z.string(),
  recommendedCommand: z.string().nullable(),
  alternativeCommands: z.array(z.string()),
  promptCommand: z.string().nullable(),
  expectedInputPath: z.string().nullable(),
  followUpCommand: z.string().nullable(),
  canProceedWithoutAgent: z.boolean(),
  planningMissingConditions: z.array(z.string()).optional(),
  planningUpdateInputPath: z.string().nullable().optional(),
});
export type GuidanceResultData = z.infer<typeof GuidanceResultDataSchema>;
