import { z } from "zod";

export const PromptKindSchema = z.enum(["update", "plan", "checkpoint", "driver", "interview"]);
export type PromptKind = z.infer<typeof PromptKindSchema>;

export const PROMPT_KINDS: readonly PromptKind[] = [
  "update",
  "plan",
  "checkpoint",
  "driver",
  "interview",
];

export function isValidPromptKind(value: string): value is PromptKind {
  return (PROMPT_KINDS as readonly string[]).includes(value);
}

/** The three file/stdin-input prompt kinds, as distinct from the read-only driver/interview kinds. */
export const FileBasedPromptKindSchema = z.enum(["update", "plan", "checkpoint"]);
export type FileBasedPromptKind = z.infer<typeof FileBasedPromptKindSchema>;

export const PromptResultDataSchema = z.object({
  promptKind: FileBasedPromptKindSchema,
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

/** M8 §15: aiqt prompt driver's CommandResult.data payload. Read-only prompt output, not canonical state. */
export const DriverPromptDataSchema = z.object({
  promptType: z.literal("driver"),
  idea: z.string().nullable(),
  prompt: z.string(),
  preferredInputMode: z.literal("stdin"),
  optionalInputMode: z.literal("from-file"),
  nextRecommendedCommand: z.string(),
});
export type DriverPromptData = z.infer<typeof DriverPromptDataSchema>;

/** M8 §15: aiqt prompt interview's CommandResult.data payload. Read-only prompt output, not canonical state. */
export const InterviewPromptDataSchema = z.object({
  promptType: z.literal("interview"),
  idea: z.string().nullable(),
  detectedProjectType: z.string().nullable(),
  questions: z.array(z.string()),
  prompt: z.string(),
  followUpCommand: z.string(),
});
export type InterviewPromptData = z.infer<typeof InterviewPromptDataSchema>;
