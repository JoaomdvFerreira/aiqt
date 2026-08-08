import type { StateModel } from "../schema/state.schema.js";
import type { DefectRecord, DefectStatus } from "../schema/defect.schema.js";
import { computeTriageDecision } from "../workflow/defect-triage.js";
import { validateDefectTransition } from "../workflow/defect-transitions.js";

export type TriageApplyOutcome =
  | { ok: true; defect: DefectRecord; transitions: { from: DefectStatus; to: DefectStatus }[] }
  | { ok: false; reason: string };

const TRIAGEABLE_STATUSES: readonly DefectStatus[] = ["candidate", "triaged", "reopened"];

/** Section 6/9 WU42-03: maps a triage disposition to the defect status it targets. */
function dispositionTargetStatus(disposition: ReturnType<typeof computeTriageDecision>["queueDisposition"]): DefectStatus {
  switch (disposition) {
    case "queue":
      return "queued";
    case "defer":
      return "deferred";
    case "needs_human":
      return "needs_human";
    case "invalidate":
      return "invalid";
    case "duplicate":
      return "duplicate";
  }
}

/**
 * Runs deterministic triage on one defect and applies its resulting
 * status transition(s). `candidate`/`reopened` first move to `triaged`
 * (Section 4.2's lifecycle), then immediately to whatever status the
 * disposition targets, in the same call -- both hops are validated
 * against DEFECT_TRANSITIONS and fail closed. Re-triaging an
 * already-`triaged` defect applies just the second hop. If the disposition
 * targets the defect's current status, the triage decision is refreshed
 * in place with no status transition (idempotent re-triage).
 */
export function applyTriage(state: StateModel, defectId: string, now: string): TriageApplyOutcome {
  const defects = state.defects ?? [];
  const defect = defects.find((d) => d.defectId === defectId);
  if (!defect) {
    return { ok: false, reason: `No defect "${defectId}" exists.` };
  }
  if (!TRIAGEABLE_STATUSES.includes(defect.status)) {
    return {
      ok: false,
      reason: `Defect "${defectId}" is in status "${defect.status}", which is not triageable (allowed: ${TRIAGEABLE_STATUSES.join(", ")}).`,
    };
  }

  const isActiveWorkUnit = Boolean(defect.affectedWorkUnitId && defect.affectedWorkUnitId === state.currentWorkUnitId);
  const decision = computeTriageDecision({ defect, isActiveWorkUnit, now });
  const targetStatus = dispositionTargetStatus(decision.queueDisposition);

  const transitions: { from: DefectStatus; to: DefectStatus }[] = [];
  let currentStatus = defect.status;

  if (currentStatus === "candidate" || currentStatus === "reopened") {
    const toTriaged = validateDefectTransition(currentStatus, "triaged");
    if (!toTriaged.ok) {
      return { ok: false, reason: toTriaged.reason ?? "Illegal transition to triaged." };
    }
    transitions.push({ from: currentStatus, to: "triaged" });
    currentStatus = "triaged";
  }

  if (targetStatus !== currentStatus) {
    const toTarget = validateDefectTransition(currentStatus, targetStatus);
    if (!toTarget.ok) {
      return { ok: false, reason: toTarget.reason ?? `Illegal transition to ${targetStatus}.` };
    }
    transitions.push({ from: currentStatus, to: targetStatus });
    currentStatus = targetStatus;
  }

  const updated: DefectRecord = {
    ...defect,
    status: currentStatus,
    triage: decision,
    updatedAt: now,
  };

  return { ok: true, defect: updated, transitions };
}
