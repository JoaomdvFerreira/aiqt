import { z } from "zod";
import {
  ValidationResultSchema,
  AcceptanceCriteriaResultSchema,
  CheckpointIssueSeveritySchema,
  CheckpointIssueStatusSchema,
  CheckpointDispositionSchema,
  FinalWorkUnitStatusSchema,
} from "./checkpoint.schema.js";

export const ValidationCommandResultInputSchema = z
  .object({
    command: z.string().min(1),
    result: ValidationResultSchema,
    summary: z.string().nullable().optional(),
  })
  .strict();
export type ValidationCommandResultInput = z.infer<
  typeof ValidationCommandResultInputSchema
>;

export const AcceptanceCriterionResultInputSchema = z
  .object({
    criterion: z.string().min(1),
    result: AcceptanceCriteriaResultSchema,
    evidence: z.string().nullable().optional(),
  })
  .strict();
export type AcceptanceCriterionResultInput = z.infer<
  typeof AcceptanceCriterionResultInputSchema
>;

export const CheckpointIssueInputSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    severity: CheckpointIssueSeveritySchema,
    status: CheckpointIssueStatusSchema.optional(),
    agentCanFix: z.boolean().optional(),
  })
  .strict();
export type CheckpointIssueInput = z.infer<typeof CheckpointIssueInputSchema>;

export const CheckpointInputSchema = z
  .object({
    summary: z.string().min(1),
    completed: z.array(z.string().min(1)).default([]),
    notCompleted: z.array(z.string().min(1)).default([]),
    reviewRequirements: z.array(z.string().min(1)).default([]),
    filesChanged: z.array(z.string().min(1)).default([]),
    validationResult: ValidationResultSchema,
    acceptanceCriteriaResult: AcceptanceCriteriaResultSchema,
    validationCommands: z.array(ValidationCommandResultInputSchema).default([]),
    acceptanceCriteria: z.array(AcceptanceCriterionResultInputSchema).default([]),
    issues: z.array(CheckpointIssueInputSchema).default([]),
    disposition: CheckpointDispositionSchema.optional(),
    targetStatus: FinalWorkUnitStatusSchema.optional(),
    notes: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.disposition === "progress" && input.targetStatus !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetStatus"], message: "A progress checkpoint cannot declare a terminal targetStatus." });
    }
  });
export type CheckpointInput = z.infer<typeof CheckpointInputSchema>;
