import { z } from "zod";

/** Actor/source enums shared across canonical records. */
export const ActorSchema = z.enum(["human", "aiqt", "agent", "system"]);
export type Actor = z.infer<typeof ActorSchema>;

export const SourceSchema = z.enum(["human", "aiqt", "agent", "system"]);
export type Source = z.infer<typeof SourceSchema>;

/** ISO-8601 timestamp string. Kept as z.string() per M1 contract. */
export const IsoDateSchema = z.string();

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const RequirementTypeSchema = z.enum([
  "functional",
  "non_functional",
  "technical",
  "business",
]);
export type RequirementType = z.infer<typeof RequirementTypeSchema>;

export const RequirementStatusSchema = z.enum([
  "draft",
  "accepted",
  "rejected",
  "implemented",
]);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const RequirementSchema = z.object({
  id: z.string(),
  clientKey: z.string().optional(),
  title: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  type: RequirementTypeSchema,
  acceptanceCriteria: z.array(z.string()),
  status: RequirementStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const DecisionStatusSchema = z.enum([
  "proposed",
  "decided",
  "superseded",
  "rejected",
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  clientKey: z.string().optional(),
  decision: z.string(),
  reason: z.string(),
  impact: z.string(),
  status: DecisionStatusSchema,
  date: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const RiskStatusSchema = z.enum([
  "open",
  "mitigated",
  "accepted",
  "closed",
]);
export type RiskStatus = z.infer<typeof RiskStatusSchema>;

export const RiskSchema = z.object({
  id: z.string(),
  clientKey: z.string().optional(),
  title: z.string(),
  description: z.string(),
  severity: SeveritySchema,
  mitigation: z.string().nullable(),
  status: RiskStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Risk = z.infer<typeof RiskSchema>;

export const OpenQuestionImpactSchema = z.enum([
  "low",
  "medium",
  "high",
  "blocking",
]);
export type OpenQuestionImpact = z.infer<typeof OpenQuestionImpactSchema>;

export const OpenQuestionStatusSchema = z.enum([
  "open",
  "answered",
  "dismissed",
]);
export type OpenQuestionStatus = z.infer<typeof OpenQuestionStatusSchema>;

export const OpenQuestionSchema = z.object({
  id: z.string(),
  clientKey: z.string().optional(),
  question: z.string(),
  impact: OpenQuestionImpactSchema,
  status: OpenQuestionStatusSchema,
  answer: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

export const AssumptionSchema = z.object({
  id: z.string(),
  clientKey: z.string().optional(),
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
