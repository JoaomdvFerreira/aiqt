import { selectTestImpact } from "./test-impact-selection.js";
import { filterTrustedFeedback, type RejectedFeedback } from "./test-impact-feedback.js";
import type { SelectedTestTarget, TestImpactInput, TestImpactSelection, ValidationFeedbackRef } from "../schema/test-impact.schema.js";

/**
 * M41-WU04 (build spec Sec 7.4, 10): wraps the WU41-02 deterministic
 * selector with trust filtering and safe ordering/escalation adaptation.
 * `selectTestImpact` itself stays unmodified and still directly usable
 * (e.g. by tests) -- this is strictly an additive layer:
 *   - stale/mismatched feedback is filtered out BEFORE it ever reaches
 *     the selector, so it cannot promote/suppress anything as "current
 *     verified evidence" (build spec Sec 10);
 *   - trusted feedback may reorder (never remove) selected targets --
 *     prior failures first, then known-duration targets by ascending
 *     duration, unknown-duration targets last, with a stable original-
 *     order tiebreak so results stay deterministic;
 *   - one or more unresolved trusted prior failures downgrades an
 *     otherwise-clean escalation to `broaden_required` rather than
 *     silently reporting a clean pass while a real prior failure for
 *     this exact change is still unaddressed.
 */

export interface FeedbackTrustOptions {
  maxAgeMs?: number;
  now?: () => string;
}

export interface AdaptiveTestImpactResult {
  selection: TestImpactSelection;
  trustedFeedbackCount: number;
  rejectedFeedback: RejectedFeedback[];
}

function reorderByFailureAndDuration(targets: readonly SelectedTestTarget[], trusted: readonly ValidationFeedbackRef[]): SelectedTestTarget[] {
  const failedTargetIds = new Set(trusted.filter((f) => f.outcome === "failed").map((f) => f.targetId));
  const durationById = new Map(trusted.filter((f): f is ValidationFeedbackRef & { durationMs: number } => f.durationMs !== null).map((f) => [f.targetId, f.durationMs]));

  return targets
    .map((t, idx) => ({ t, idx }))
    .sort((a, b) => {
      // Mandatory targets always stay first (matches build spec Sec 5.2/7.1 -- duration/history may never demote a mandatory target).
      if (a.t.mandatory !== b.t.mandatory) return a.t.mandatory ? -1 : 1;
      const aFail = failedTargetIds.has(a.t.target.id) ? 1 : 0;
      const bFail = failedTargetIds.has(b.t.target.id) ? 1 : 0;
      if (aFail !== bFail) return bFail - aFail;
      const aDur = durationById.get(a.t.target.id);
      const bDur = durationById.get(b.t.target.id);
      if (aDur !== undefined && bDur !== undefined && aDur !== bDur) return aDur - bDur;
      if (aDur !== undefined && bDur === undefined) return -1;
      if (aDur === undefined && bDur !== undefined) return 1;
      return a.idx - b.idx;
    })
    .map(({ t }, newOrder) => ({ ...t, order: newOrder }));
}

export function selectTestImpactWithFeedback(input: TestImpactInput, trustOptions: FeedbackTrustOptions = {}): AdaptiveTestImpactResult {
  const currentChangeIdentity = input.currentChangeIdentity ?? input.workUnitId;
  const { trusted, rejected } = filterTrustedFeedback(input.priorFeedback, {
    currentChangeIdentity,
    maxAgeMs: trustOptions.maxAgeMs,
    now: trustOptions.now,
  });

  const base = selectTestImpact({ ...input, priorFeedback: trusted });
  const reordered = reorderByFailureAndDuration(base.selectedTargets, trusted);

  const evidenceGaps = [...base.evidenceGaps, ...rejected.map((r) => ({ code: "STALE-FEEDBACK-REJECTED", message: r.reason }))];

  let escalation = base.escalation;
  let confidence = base.confidence;
  const trustedFailureCount = trusted.filter((f) => f.outcome === "failed").length;
  if (trustedFailureCount > 0 && (escalation === "selected_focused" || escalation === "selected_impacted")) {
    escalation = "broaden_required";
    if (confidence === "high") confidence = "medium";
    evidenceGaps.push({
      code: "UNRESOLVED-PRIOR-FAILURE",
      message: `${trustedFailureCount} trusted prior failure(s) for this change are unresolved; broadening rather than reporting a clean pass.`,
    });
  }

  return {
    selection: { ...base, selectedTargets: reordered, escalation, confidence, evidenceGaps },
    trustedFeedbackCount: trusted.length,
    rejectedFeedback: rejected,
  };
}
