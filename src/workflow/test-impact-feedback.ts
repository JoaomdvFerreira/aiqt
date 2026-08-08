import type { ValidationFeedbackRef } from "../schema/test-impact.schema.js";
import type { Checkpoint } from "../schema/checkpoint.schema.js";
import { validationCommandTargetId } from "./test-impact-input.js";

/**
 * M41-WU04 (build spec Sec 10): bounded, deterministic prior-evidence
 * trust filtering and extraction. Reuses the existing canonical
 * `state.checkpoints`/`ValidationCommandResult` owner (checkpoint.schema.ts)
 * -- no new validation-history database, no raw log persistence.
 */

export interface RejectedFeedback {
  ref: ValidationFeedbackRef;
  reason: string;
}

export interface FeedbackTrustInput {
  currentChangeIdentity: string;
  /** Optional bounded staleness window; omit to trust any age as long as the identity matches. */
  maxAgeMs?: number;
  now?: () => string;
}

export interface FeedbackTrustResult {
  trusted: ValidationFeedbackRef[];
  rejected: RejectedFeedback[];
}

/**
 * "A prior result that is stale, from a mismatched commit/scope, or
 * otherwise untrusted must not be treated as current verified evidence"
 * (build spec Sec 10). Mismatch on `changeIdentity` is the primary
 * rejection signal; an optional `maxAgeMs` adds a bounded time window.
 * Never mutates or removes anything from a selection -- this only
 * decides what prior evidence is even eligible to be read downstream.
 */
export function filterTrustedFeedback(feedback: readonly ValidationFeedbackRef[], input: FeedbackTrustInput): FeedbackTrustResult {
  const now = input.now ?? (() => new Date().toISOString());
  const nowMs = Date.parse(now());
  const trusted: ValidationFeedbackRef[] = [];
  const rejected: RejectedFeedback[] = [];

  for (const ref of feedback) {
    if (ref.changeIdentity !== input.currentChangeIdentity) {
      rejected.push({ ref, reason: `Feedback for "${ref.targetId}" has changeIdentity "${ref.changeIdentity}", which does not match the current change ("${input.currentChangeIdentity}") -- stale/mismatched, not treated as verified evidence.` });
      continue;
    }
    if (input.maxAgeMs !== undefined) {
      const refMs = Date.parse(ref.evidenceTimestamp);
      if (Number.isNaN(refMs) || nowMs - refMs > input.maxAgeMs) {
        rejected.push({ ref, reason: `Feedback for "${ref.targetId}" is older than the trust window (${input.maxAgeMs}ms) or has an unparsable timestamp -- not treated as verified evidence.` });
        continue;
      }
    }
    trusted.push(ref);
  }

  return { trusted, rejected };
}

/**
 * Bounded, deterministic extraction from a Work Unit's own canonical
 * checkpoints (build spec Sec 10: "target/command, outcome, relevant WU/
 * change identity, duration when already measured, failure category when
 * available, evidence timestamp/source"). `changeIdentity` is the
 * checkpoint id -- the closest already-canonical anchor to "the exact
 * change this feedback was captured against" available on Checkpoint
 * (no commit sha field exists there). Checkpoint validation commands
 * carry no duration field, so `durationMs` is always null from this
 * source -- honest, not fabricated.
 */
export function loadValidationFeedbackFromCheckpoints(checkpoints: readonly Checkpoint[], workUnitId: string, maxEntries = 20): ValidationFeedbackRef[] {
  const relevant = checkpoints.filter((c) => c.workUnitId === workUnitId).slice(-maxEntries);
  const refs: ValidationFeedbackRef[] = [];
  for (const checkpoint of relevant) {
    for (const vc of checkpoint.validationCommands) {
      refs.push({
        targetId: validationCommandTargetId(vc.command),
        outcome: vc.result === "passed" ? "passed" : vc.result === "failed" ? "failed" : "unknown",
        workUnitId: checkpoint.workUnitId,
        changeIdentity: checkpoint.id,
        durationMs: null,
        failureCategory: vc.result === "failed" ? "validation_command_failed" : null,
        evidenceTimestamp: checkpoint.createdAt,
        evidenceSource: `checkpoint:${checkpoint.id}`,
      });
    }
  }
  return refs;
}
