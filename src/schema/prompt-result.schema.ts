import { z } from "zod";

export const PromptKindSchema = z.enum(["update", "plan", "checkpoint"]);
export type PromptKind = z.infer<typeof PromptKindSchema>;

export const PROMPT_KINDS: readonly PromptKind[] = ["update", "plan", "checkpoint"];

export function isValidPromptKind(value: string): value is PromptKind {
  return (PROMPT_KINDS as readonly string[]).includes(value);
}

export const PromptResultDataSchema = z.object({
  promptKind: PromptKindSchema,
  prompt: z.string(),
  suggestedOutputPath: z.string(),
  followUpCommand: z.string(),
  stateSummary: z.object({
    planningContextReady: z.boolean(),
    projectStatus: z.string().nullable(),
    currentMilestoneId: z.string().nullable(),
    currentWorkUnitId: z.string().nullable(),
    nextRecommendedCommand: z.string().nullable(),
  }),
  wroteFile: z.boolean(),
  outputPath: z.string().nullable(),
});
export type PromptResultData = z.infer<typeof PromptResultDataSchema>;
