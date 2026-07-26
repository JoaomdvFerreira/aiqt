import {
  CHECKPOINT_EVIDENCE_ADVISORY_PROTOCOL_VERSION,
  MAX_ADVISORY_OBSERVATIONS_PER_CHECKPOINT,
  type CheckpointAdvisoryObservation,
  type CheckpointEvidenceAdvisory,
} from "../schema/checkpoint-evidence-advisory.schema.js";

/**
 * M29 §3.1: "the same observation ID and payload is a no-op; the same
 * observation ID with different payload is exit 3." `recordedAt` is
 * excluded from this comparison: it is the wall-clock instant the command
 * happened to run, not part of the observation's logical identity or
 * content (deterministic `observationId` already covers checkpoint,
 * trigger, policy identity, asOf, and result) -- comparing it verbatim
 * would make every real replay a spurious conflict. Every other field of
 * CheckpointAdvisoryObservation is a bounded primitive, string array, or
 * plain object, so structural JSON equality is otherwise safe.
 */
function observationsEqual(a: CheckpointAdvisoryObservation, b: CheckpointAdvisoryObservation): boolean {
  const { recordedAt: _a, ...restA } = a;
  const { recordedAt: _b, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

export type ApplyAdvisoryObservationOutcome =
  | { kind: "created"; advisory: CheckpointEvidenceAdvisory }
  | { kind: "no_op"; advisory: CheckpointEvidenceAdvisory; matched: CheckpointAdvisoryObservation }
  | { kind: "conflict"; existing: CheckpointAdvisoryObservation };

/**
 * M29 §3.1/§3.3: pure state-overlay transition. Applies latest-N pruning
 * (oldest observation removed only once the bound is exceeded) and never
 * mutates its inputs. Callers persist the returned advisory and append the
 * runlog event only for the "created" outcome.
 */
export function applyAdvisoryObservation(
  existing: CheckpointEvidenceAdvisory | undefined,
  observation: CheckpointAdvisoryObservation,
): ApplyAdvisoryObservationOutcome {
  if (existing) {
    const duplicate = existing.history.find((o) => o.observationId === observation.observationId);
    if (duplicate) {
      if (observationsEqual(duplicate, observation)) {
        return { kind: "no_op", advisory: existing, matched: duplicate };
      }
      return { kind: "conflict", existing: duplicate };
    }
  }

  const history = existing ? [...existing.history, observation] : [observation];
  const pruned =
    history.length > MAX_ADVISORY_OBSERVATIONS_PER_CHECKPOINT
      ? history.slice(history.length - MAX_ADVISORY_OBSERVATIONS_PER_CHECKPOINT)
      : history;

  return {
    kind: "created",
    advisory: {
      protocolVersion: CHECKPOINT_EVIDENCE_ADVISORY_PROTOCOL_VERSION,
      checkpointId: observation.checkpointId,
      current: observation,
      history: pruned,
    },
  };
}

/** Replace (or append) one checkpoint's advisory record in the state-level array. */
export function upsertCheckpointAdvisory(
  advisories: readonly CheckpointEvidenceAdvisory[],
  updated: CheckpointEvidenceAdvisory,
): CheckpointEvidenceAdvisory[] {
  const index = advisories.findIndex((a) => a.checkpointId === updated.checkpointId);
  if (index === -1) return [...advisories, updated];
  const copy = [...advisories];
  copy[index] = updated;
  return copy;
}

export function findCheckpointAdvisory(
  advisories: readonly CheckpointEvidenceAdvisory[] | undefined,
  checkpointId: string,
): CheckpointEvidenceAdvisory | undefined {
  return advisories?.find((a) => a.checkpointId === checkpointId);
}
