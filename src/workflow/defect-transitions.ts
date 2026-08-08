import type { DefectStatus } from "../schema/defect.schema.js";

/**
 * Section 4.2: the bounded defect lifecycle transition table. Pure,
 * deterministic, no I/O -- mirrors the M36-WU01 lifecycle-status-enum +
 * transition-table precedent. Illegal transitions must fail closed.
 */
export const DEFECT_TRANSITIONS: Readonly<Record<DefectStatus, readonly DefectStatus[]>> = {
  candidate: ["triaged", "invalid"],
  triaged: ["queued", "deferred", "invalid", "duplicate"],
  queued: ["in_progress", "deferred", "needs_human", "invalid"],
  in_progress: ["needs_human", "resolved", "queued", "deferred"],
  needs_human: ["queued", "deferred", "invalid"],
  deferred: ["queued", "triaged", "invalid"],
  resolved: ["reopened"],
  reopened: ["triaged", "queued"],
  invalid: [],
  duplicate: ["triaged"],
};

/** Queue-eligible statuses: a `RemediationQueueEntry` is a `DefectRecord` in one of these. */
export const QUEUE_ELIGIBLE_STATUSES: readonly DefectStatus[] = [
  "queued",
  "in_progress",
  "needs_human",
];

export function isValidDefectTransition(from: DefectStatus, to: DefectStatus): boolean {
  if (from === to) return false;
  return DEFECT_TRANSITIONS[from].includes(to);
}

export interface DefectTransitionResult {
  ok: boolean;
  reason?: string;
}

/** Fails closed: any transition not explicitly listed in DEFECT_TRANSITIONS is rejected. */
export function validateDefectTransition(from: DefectStatus, to: DefectStatus): DefectTransitionResult {
  if (from === to) {
    return { ok: false, reason: `Defect is already in status "${from}".` };
  }
  if (!DEFECT_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      reason: `Illegal defect status transition: "${from}" -> "${to}". Allowed from "${from}": ${
        DEFECT_TRANSITIONS[from].length > 0 ? DEFECT_TRANSITIONS[from].join(", ") : "(none, terminal)"
      }.`,
    };
  }
  return { ok: true };
}
