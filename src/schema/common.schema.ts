import { z } from "zod";

/** Actor/source enums shared across canonical records. */
export const ActorSchema = z.enum(["human", "aiqt", "agent", "system"]);
export type Actor = z.infer<typeof ActorSchema>;

export const SourceSchema = z.enum(["human", "aiqt", "agent", "system"]);
export type Source = z.infer<typeof SourceSchema>;

/** ISO-8601 timestamp string. Kept as z.string() per M1 contract. */
export const IsoDateSchema = z.string();

export const RequirementSchema = z.object({
  id: z.string(),
  statement: z.string(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  statement: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const RiskSchema = z.object({
  id: z.string(),
  statement: z.string(),
});
export type Risk = z.infer<typeof RiskSchema>;

export const OpenQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

export const AssumptionSchema = z.object({
  id: z.string(),
  statement: z.string(),
  reason: z.string().nullable(),
  source: z.enum(["human", "aiqt", "agent", "system"]),
  status: z.enum(["active", "replaced", "invalidated"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const QualityExpectationsSchema = z.object({
  acceptanceCriteriaRequired: z.boolean(),
  validationRequiredBeforeDone: z.boolean(),
  preferredValidationCommands: z.array(z.string()),
});
export type QualityExpectations = z.infer<typeof QualityExpectationsSchema>;

export const IntegrationsSchema = z.record(z.unknown());
export type Integrations = z.infer<typeof IntegrationsSchema>;
