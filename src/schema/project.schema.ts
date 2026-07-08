import { z } from "zod";
import {
  RequirementSchema,
  DecisionSchema,
  RiskSchema,
  OpenQuestionSchema,
  AssumptionSchema,
  QualityExpectationsSchema,
  IntegrationsSchema,
} from "./common.schema.js";

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  objective: z.string(),
  targetUsers: z.array(z.string()),
  preferredAgent: z.string().nullable(),
  existingRepositoryPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectContextSchema = z.object({
  constraints: z.array(z.string()),
  nonGoals: z.array(z.string()),
  technologyPreferences: z.array(z.string()),
  businessRules: z.array(z.string()),
  architectureNotes: z.array(z.string()),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

export const ProjectModelSchema = z.object({
  version: z.string(),
  project: ProjectSchema,
  context: ProjectContextSchema,
  requirements: z.array(RequirementSchema),
  decisions: z.array(DecisionSchema),
  risks: z.array(RiskSchema),
  assumptions: z.array(AssumptionSchema),
  openQuestions: z.array(OpenQuestionSchema),
  quality: QualityExpectationsSchema,
  integrations: IntegrationsSchema.optional(),
});
export type ProjectModel = z.infer<typeof ProjectModelSchema>;
