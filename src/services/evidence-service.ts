import type { StateModel } from "../schema/state.schema.js";
import type { EvidenceRecord } from "../schema/evidence.schema.js";
import type { DecisionEscalation } from "../schema/decision-escalation.schema.js";

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
