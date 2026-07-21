import type { StateModel } from "../schema/state.schema.js";
import type { EvidenceRecord, EvidenceState } from "../schema/evidence.schema.js";
import { EVIDENCE_RECORDS_HARD_CAP } from "../schema/evidence.schema.js";
import type { DecisionEscalation } from "../schema/decision-escalation.schema.js";
import { DECISION_ESCALATIONS_HARD_CAP } from "../schema/decision-escalation.schema.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";
import { buildEvidenceRecordedEvent, buildDecisionEscalationCreatedEvent } from "../state/runlog-store.js";

/** M22-WU02: missing state.evidence must be treated as an empty EvidenceRecord collection. */
export function getEvidenceRecords(state: StateModel): EvidenceRecord[] {
  return state.evidence?.records ?? [];
}

/** M22-WU02: missing state.evidence must be treated as an empty DecisionEscalation collection. */
export function getDecisionEscalations(state: StateModel): DecisionEscalation[] {
  return state.evidence?.decisionEscalations ?? [];
}

export function findEvidenceRecordById(
  evidenceId: string,
  records: readonly EvidenceRecord[],
): EvidenceRecord | undefined {
  return records.find((r) => r.evidenceId === evidenceId);
}

export function findDecisionEscalationByKey(
  escalationKey: string,
  escalations: readonly DecisionEscalation[],
): DecisionEscalation | undefined {
  return escalations.find((e) => e.escalationKey === escalationKey);
}

/**
 * M22-WU08 §7.1: the result of every candidate-state builder in this
 * module. On `ok: false`, the caller must not persist anything -- no
 * partial state or runlog mutation is allowed (M22 §7.1). On `ok: true`
 * with `changed: false`, the request was an idempotent no-op/link and no
 * runlog event should be appended either (M22 §7.2/§7.3).
 */
export type EvidenceCandidateResult =
  | { ok: true; changed: boolean; state: EvidenceState; runlogEvent: RunlogEvent | null }
  | { ok: false; error: string };

export interface RecordEvidenceParams {
  state: StateModel;
  evidence: EvidenceRecord;
  timestamp: string;
  eventId: string;
}

/**
 * M22-WU08 §7.1-§7.4: candidate-state builder for recording one
 * EvidenceRecord. Pure -- the caller is responsible for
 * `writeStateModel`/`appendRunlogEvent` using the repository's
 * established atomic-write sequence. Validates that the referenced work
 * unit, checkpoint (when given), and decision-escalation IDs resolve
 * against canonical state before allowing the mutation, and refuses a
 * broken reference or an exceeded hard cap with no partial write. A
 * repeated `evidence.evidenceId` is an idempotent no-op: no second
 * record, no runlog event.
 */
export function buildRecordEvidenceCandidate(params: RecordEvidenceParams): EvidenceCandidateResult {
  const { state, evidence, timestamp, eventId } = params;
  const existingRecords = getEvidenceRecords(state);
  const existingEscalations = getDecisionEscalations(state);

  if (findEvidenceRecordById(evidence.evidenceId, existingRecords)) {
    return {
      ok: true,
      changed: false,
      state: { records: existingRecords, decisionEscalations: existingEscalations },
      runlogEvent: null,
    };
  }

  const workUnitExists = state.workGraph.workUnits.some(
    (wu) => wu.id === evidence.workflowBinding.workUnitId,
  );
  if (!workUnitExists) {
    return { ok: false, error: `Unknown work unit reference: ${evidence.workflowBinding.workUnitId}` };
  }

  if (evidence.workflowBinding.checkpointId) {
    const checkpointExists = state.checkpoints.some((cp) => cp.id === evidence.workflowBinding.checkpointId);
    if (!checkpointExists) {
      return { ok: false, error: `Unknown checkpoint reference: ${evidence.workflowBinding.checkpointId}` };
    }
  }

  for (const escalationId of evidence.decisionEscalationIds) {
    if (!existingEscalations.some((e) => e.escalationId === escalationId)) {
      return { ok: false, error: `Unknown decision escalation reference: ${escalationId}` };
    }
  }

  if (existingRecords.length >= EVIDENCE_RECORDS_HARD_CAP) {
    return { ok: false, error: `evidence_records_hard_cap (${EVIDENCE_RECORDS_HARD_CAP}) exceeded` };
  }

  const runlogEvent = buildEvidenceRecordedEvent({
    id: eventId,
    timestamp,
    relatedIds: [evidence.evidenceId, evidence.workflowBinding.workUnitId],
    data: {
      evidenceId: evidence.evidenceId,
      workUnitId: evidence.workflowBinding.workUnitId,
      providerType: evidence.provider.providerType,
      trustLevel: evidence.provider.trustLevel,
      sourceFindingCount: evidence.sourceFindings.length,
      artifactReferenceCount: evidence.artifactReferences.length,
    },
  });

  return {
    ok: true,
    changed: true,
    state: { records: [...existingRecords, evidence], decisionEscalations: existingEscalations },
    runlogEvent,
  };
}

export interface RecordDecisionEscalationParams {
  state: StateModel;
  escalation: DecisionEscalation;
  timestamp: string;
  eventId: string;
}

/**
 * M22-WU08 §7.1-§7.4: candidate-state builder for recording one
 * DecisionEscalation. A repeated `escalationKey` links to the existing
 * record (M22 §5.7) -- idempotent no-op, no second record, no runlog
 * event.
 */
export function buildRecordDecisionEscalationCandidate(
  params: RecordDecisionEscalationParams,
): EvidenceCandidateResult {
  const { state, escalation, timestamp, eventId } = params;
  const existingRecords = getEvidenceRecords(state);
  const existingEscalations = getDecisionEscalations(state);

  if (findDecisionEscalationByKey(escalation.escalationKey, existingEscalations)) {
    return {
      ok: true,
      changed: false,
      state: { records: existingRecords, decisionEscalations: existingEscalations },
      runlogEvent: null,
    };
  }

  for (const workUnitId of escalation.relatedWorkUnitIds) {
    if (!state.workGraph.workUnits.some((wu) => wu.id === workUnitId)) {
      return { ok: false, error: `Unknown work unit reference: ${workUnitId}` };
    }
  }
  for (const milestoneId of escalation.relatedMilestoneIds) {
    if (!state.workGraph.milestones.some((m) => m.id === milestoneId)) {
      return { ok: false, error: `Unknown milestone reference: ${milestoneId}` };
    }
  }
  for (const evidenceId of escalation.evidenceIds) {
    if (!findEvidenceRecordById(evidenceId, existingRecords)) {
      return { ok: false, error: `Unknown evidence reference: ${evidenceId}` };
    }
  }

  if (existingEscalations.length >= DECISION_ESCALATIONS_HARD_CAP) {
    return { ok: false, error: `decision_escalations_hard_cap (${DECISION_ESCALATIONS_HARD_CAP}) exceeded` };
  }

  const runlogEvent = buildDecisionEscalationCreatedEvent({
    id: eventId,
    timestamp,
    relatedIds: [escalation.escalationId],
    data: {
      escalationId: escalation.escalationId,
      escalationKey: escalation.escalationKey,
      category: escalation.category,
    },
  });

  return {
    ok: true,
    changed: true,
    state: { records: existingRecords, decisionEscalations: [...existingEscalations, escalation] },
    runlogEvent,
  };
}
