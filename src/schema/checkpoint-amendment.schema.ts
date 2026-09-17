import { z } from "zod";
import {
  AcceptanceCriteriaResultSchema,
  ValidationResultSchema,
} from "./checkpoint.schema.js";

export const ReconciledAcceptanceCriterionSchema = z.object({
  /** Exact text identity of an acceptance criterion in the original checkpoint. */
  criterion: z.string().min(1),
  result: AcceptanceCriteriaResultSchema,
  /** Optional external-review evidence/reference for this reconciliation. */
  evidenceReference: z.string().min(1).optional(),
});
export type ReconciledAcceptanceCriterion = z.infer<typeof ReconciledAcceptanceCriterionSchema>;

/**
 * M12 §6: an additive, backward-compatible state extension. Amendments are
 * overlays on top of an existing checkpoint -- they never rewrite the
 * original checkpoint record. Existing state files without
 * checkpointAmendments remain valid; missing checkpointAmendments must be
 * treated as an empty array (see getCheckpointAmendments in
 * checkpoint-amendment-service.ts). Does not require an AIQT_SCHEMA_VERSION
 * bump.
 */
export const CheckpointAmendmentSchema = z.object({
  amendmentId: z.string().min(1),
  checkpointId: z.string().min(1),
  workUnitId: z.string().min(1),
  acceptanceCriteriaResult: AcceptanceCriteriaResultSchema.optional(),
  validationResult: ValidationResultSchema.optional(),
  /** Original checkpoint.notCompleted entry reconciled after review. */
  resolvedNotCompleted: z.string().min(1).optional(),
  /** Optional external-review evidence/reference for the reconciliation. */
  resolutionEvidenceReference: z.string().min(1).optional(),
  /** Original detailed acceptance criterion reconciled after review. */
  reconciledAcceptanceCriterion: ReconciledAcceptanceCriterionSchema.optional(),
  reason: z.string().min(1),
  amendedAt: z.string(),
  sourceCommand: z.literal("aiqt checkpoint amend"),
});
export type CheckpointAmendment = z.infer<typeof CheckpointAmendmentSchema>;
