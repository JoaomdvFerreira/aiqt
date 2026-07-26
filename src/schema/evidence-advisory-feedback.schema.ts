import { z } from "zod";

/** M29 §5.1: "maximum 500 feedback records per project." */
export const MAX_EVIDENCE_ADVISORY_FEEDBACK = 500;

export const AdvisoryFeedbackClassificationSchema = z.enum([
  "confirmed",
  "false_positive",
  "policy_gap",
  "evidence_missing",
]);
export type AdvisoryFeedbackClassification = z.infer<typeof AdvisoryFeedbackClassificationSchema>;

/**
 * M29 §5.1: explicit, bounded, non-semantic human classification of one
 * advisory issue. Never touches issue lifecycle, severity, readiness,
 * checkpoint state, or enforcement -- it is pure measurement data for
 * false-positive/friction telemetry (Gate J).
 */
export const EvidenceAdvisoryFeedbackSchema = z.object({
  issueKey: z.string().min(1),
  classification: AdvisoryFeedbackClassificationSchema,
  rationale: z.string().min(1).max(2000),
  recordedAt: z.string(),
  updatedAt: z.string(),
});
export type EvidenceAdvisoryFeedback = z.infer<typeof EvidenceAdvisoryFeedbackSchema>;
