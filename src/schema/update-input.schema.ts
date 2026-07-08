import { z } from "zod";
import {
  PrioritySchema,
  SeveritySchema,
  RequirementTypeSchema,
  RequirementStatusSchema,
  DecisionStatusSchema,
  RiskStatusSchema,
  OpenQuestionImpactSchema,
  OpenQuestionStatusSchema,
} from "./common.schema.js";

export const RequirementInputSchema = z
  .object({
    id: z.string().optional(),
    clientKey: z.string().optional(),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    priority: PrioritySchema.optional(),
    type: RequirementTypeSchema.optional(),
    acceptanceCriteria: z.array(z.string().min(1)).optional(),
    status: RequirementStatusSchema.optional(),
  })
  .strict();
export type RequirementInput = z.infer<typeof RequirementInputSchema>;

export const DecisionInputSchema = z
  .object({
    id: z.string().optional(),
    clientKey: z.string().optional(),
    decision: z.string().min(1).optional(),
    reason: z.string().optional(),
    impact: z.string().optional(),
    status: DecisionStatusSchema.optional(),
    date: z.string().optional(),
  })
  .strict();
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

export const AssumptionInputSchema = z
  .object({
    id: z.string().optional(),
    clientKey: z.string().optional(),
    statement: z.string().min(1).optional(),
    reason: z.string().nullable().optional(),
    source: z.enum(["human", "aiqt", "agent", "system"]).optional(),
    status: z.enum(["active", "replaced", "invalidated"]).optional(),
  })
  .strict();
export type AssumptionInput = z.infer<typeof AssumptionInputSchema>;

export const RiskInputSchema = z
  .object({
    id: z.string().optional(),
    clientKey: z.string().optional(),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    severity: SeveritySchema.optional(),
    mitigation: z.string().nullable().optional(),
    status: RiskStatusSchema.optional(),
  })
  .strict();
export type RiskInput = z.infer<typeof RiskInputSchema>;

export const OpenQuestionInputSchema = z
  .object({
    id: z.string().optional(),
    clientKey: z.string().optional(),
    question: z.string().min(1).optional(),
    impact: OpenQuestionImpactSchema.optional(),
    status: OpenQuestionStatusSchema.optional(),
    answer: z.string().nullable().optional(),
  })
  .strict();
export type OpenQuestionInput = z.infer<typeof OpenQuestionInputSchema>;

export const ProjectUpdateInputSchema = z
  .object({
    objective: z.string().min(1).optional(),
    targetUsers: z.array(z.string().min(1)).optional(),
    preferredAgent: z.string().min(1).nullable().optional(),
    existingRepositoryPath: z.string().min(1).nullable().optional(),
  })
  .strict();
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInputSchema>;

export const ContextUpdateInputSchema = z
  .object({
    constraints: z.array(z.string().min(1)).optional(),
    nonGoals: z.array(z.string().min(1)).optional(),
    technologyPreferences: z.array(z.string().min(1)).optional(),
    businessRules: z.array(z.string().min(1)).optional(),
    architectureNotes: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ContextUpdateInput = z.infer<typeof ContextUpdateInputSchema>;

export const QualityUpdateInputSchema = z
  .object({
    acceptanceCriteriaRequired: z.boolean().optional(),
    validationRequiredBeforeDone: z.boolean().optional(),
    preferredValidationCommands: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type QualityUpdateInput = z.infer<typeof QualityUpdateInputSchema>;

export const UpdateInputSchema = z
  .object({
    project: ProjectUpdateInputSchema.optional(),
    context: ContextUpdateInputSchema.optional(),
    requirements: z.array(RequirementInputSchema.strict()).optional(),
    decisions: z.array(DecisionInputSchema.strict()).optional(),
    assumptions: z.array(AssumptionInputSchema.strict()).optional(),
    risks: z.array(RiskInputSchema.strict()).optional(),
    openQuestions: z.array(OpenQuestionInputSchema.strict()).optional(),
    quality: QualityUpdateInputSchema.optional(),
  })
  .strict();
export type UpdateInput = z.infer<typeof UpdateInputSchema>;
