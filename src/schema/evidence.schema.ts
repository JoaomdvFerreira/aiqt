import { z } from "zod";
import { DecisionEscalationSchema } from "./decision-escalation.schema.js";

/**
 * M22-WU02: identity-only foundation for EvidenceRecord. Extended with
 * provider, trust, workflow/code binding, results, source findings, and
 * artifact references in WU22-04.
 */
export const EvidenceRecordSchema = z.object({
  evidenceId: z.string().min(1),
  recordedAt: z.string(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/**
 * M22-WU02: new, optional, top-level state section -- same additive
 * pattern as `state.review`/`state.checkpointAmendments`. Missing entirely
 * on pre-M22 state files; never materialized by a read-only command.
 */
export const EvidenceStateSchema = z.object({
  records: z.array(EvidenceRecordSchema),
  decisionEscalations: z.array(DecisionEscalationSchema),
});
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;
