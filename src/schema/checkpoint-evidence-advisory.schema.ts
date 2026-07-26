import { z } from "zod";

/**
 * M29 §3.3: an optional, bounded advisory projection layered onto the
 * checkpoint owner (checkpoint.schema.ts / checkpoint-service.ts) as a
 * separate state overlay, following the same pattern as M12's
 * checkpointAmendments -- never a rewrite of the immutable Checkpoint
 * record itself. Canonical state stores current/latest-N observations
 * only; the append-only runlog (evidence_gate.advisory_observation_recorded)
 * is the complete historical authority (M29 §3.1).
 */
export const CHECKPOINT_EVIDENCE_ADVISORY_PROTOCOL_VERSION =
  "aiqt-checkpoint-evidence-advisory@1" as const;

/** M29 §3.3: "maximum 10 observations per checkpoint in canonical state". */
export const MAX_ADVISORY_OBSERVATIONS_PER_CHECKPOINT = 10;

export const AdvisoryEvaluationStatusSchema = z.enum([
  "evaluated",
  "not_configured",
  "unavailable",
]);
export type AdvisoryEvaluationStatus = z.infer<typeof AdvisoryEvaluationStatusSchema>;

export const AdvisoryOverallResultSchema = z
  .enum(["pass", "fail", "indeterminate"])
  .nullable();
export type AdvisoryOverallResult = z.infer<typeof AdvisoryOverallResultSchema>;

export const AdvisoryTriggerSchema = z.enum(["checkpoint", "amendment", "manual_refresh"]);
export type AdvisoryTrigger = z.infer<typeof AdvisoryTriggerSchema>;

export const AdvisoryPolicyRefSchema = z.object({
  policyId: z.string().optional(),
  version: z.number().int().optional(),
  digest: z.string().optional(),
});
export type AdvisoryPolicyRef = z.infer<typeof AdvisoryPolicyRefSchema>;

/**
 * M29 §3.1: the bounded payload shared by both the runlog event and the
 * canonical state mirror. No evidence body, artifact metadata, provider
 * payload, validation output, or human rationale is permitted here.
 */
export const CheckpointAdvisoryObservationSchema = z.object({
  observationId: z.string().min(1),
  checkpointId: z.string().min(1),
  workUnitId: z.string().min(1),
  trigger: AdvisoryTriggerSchema,
  evaluationStatus: AdvisoryEvaluationStatusSchema,
  overallResult: AdvisoryOverallResultSchema,
  policyRef: AdvisoryPolicyRefSchema.optional(),
  asOf: z.string(),
  simulationDigest: z.string().optional(),
  issueKeys: z.array(z.string()),
  summary: z.string().max(500),
  recordedAt: z.string(),
});
export type CheckpointAdvisoryObservation = z.infer<typeof CheckpointAdvisoryObservationSchema>;

/**
 * One checkpoint's current advisory status plus its bounded latest-N
 * mirror. `current` is always `history[history.length - 1]`; `history` is
 * pruned oldest-first once MAX_ADVISORY_OBSERVATIONS_PER_CHECKPOINT is
 * exceeded. Pruning this array never removes or rewrites runlog history.
 */
export const CheckpointEvidenceAdvisorySchema = z.object({
  protocolVersion: z.literal(CHECKPOINT_EVIDENCE_ADVISORY_PROTOCOL_VERSION),
  checkpointId: z.string().min(1),
  current: CheckpointAdvisoryObservationSchema,
  history: z.array(CheckpointAdvisoryObservationSchema).max(MAX_ADVISORY_OBSERVATIONS_PER_CHECKPOINT),
});
export type CheckpointEvidenceAdvisory = z.infer<typeof CheckpointEvidenceAdvisorySchema>;
