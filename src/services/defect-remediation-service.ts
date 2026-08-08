import type { DefectRecord, RemediationDecision, RemediationEvidence } from "../schema/defect.schema.js";
import { computeRemediationRisk } from "../workflow/remediation-risk.js";
import { validateDefectTransition } from "../workflow/defect-transitions.js";

export interface PrepareRemediationInput {
  defect: DefectRecord;
  remediationId: string;
  objective: string;
  scope: string[];
  outOfScope: string[];
  acceptanceContract: string;
  approvedBy?: string;
  now: string;
}

export type PrepareRemediationOutcome =
  | {
      ok: true;
      defect: DefectRecord;
      remediation: RemediationDecision;
      transitioned: boolean;
    }
  | { ok: false; reason: string; requiresHumanApproval?: boolean };

/**
 * Section 8/9 WU42-04: builds a bounded remediation request/decision and,
 * when eligible, transitions the defect `queued -> in_progress`. This is
 * the M42 remediation boundary -- it performs no execution, no sandbox
 * call, no process spawn, and no filesystem mutation beyond the defect
 * record itself (Section 8: "AIQT must emit a bounded external-agent
 * handoff/request" when no live controlled-execution path is wired in;
 * no second execution engine is created here). Risk >=50 requires an
 * explicit `approvedBy` human identity before it will proceed -- without
 * one, nothing is persisted and the defect status is left untouched
 * (Section 6.3/Definition of Done item 9's human boundary).
 */
export function prepareRemediation(input: PrepareRemediationInput): PrepareRemediationOutcome {
  const { defect } = input;

  if (defect.status !== "queued") {
    return {
      ok: false,
      reason: `Defect "${defect.defectId}" is in status "${defect.status}", not "queued". Triage or transition it to "queued" before preparing remediation.`,
    };
  }

  const risk = computeRemediationRisk({ scope: input.scope, affectedWorkUnitId: defect.affectedWorkUnitId });

  if (risk.requiresHumanApproval && !input.approvedBy) {
    return {
      ok: false,
      reason: `Remediation risk ${risk.score}/100 (${risk.band}) requires explicit human approval via --approved-by before proceeding. No state was changed.`,
      requiresHumanApproval: true,
    };
  }

  const transitionCheck = validateDefectTransition(defect.status, "in_progress");
  if (!transitionCheck.ok) {
    return { ok: false, reason: transitionCheck.reason ?? "Illegal transition to in_progress." };
  }

  const remediation: RemediationDecision = {
    remediationId: input.remediationId,
    objective: input.objective,
    scope: input.scope,
    outOfScope: input.outOfScope,
    acceptanceContract: input.acceptanceContract,
    remediationRiskScore: risk.score,
    remediationRiskBand: risk.band,
    approvalRequired: risk.requiresHumanApproval,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedBy ? input.now : undefined,
    outcome: "in_progress",
    createdAt: input.now,
    updatedAt: input.now,
  };

  const updated: DefectRecord = {
    ...defect,
    status: "in_progress",
    remediation,
    updatedAt: input.now,
  };

  return { ok: true, defect: updated, remediation, transitioned: true };
}

export interface RecordValidationInput {
  defect: DefectRecord;
  outcome: "passed" | "failed";
  evidenceLocator: string;
  note?: string;
  now: string;
}

export type RecordValidationOutcome =
  | { ok: true; defect: DefectRecord; transition: { from: string; to: string } }
  | { ok: false; reason: string };

/**
 * Section 3.6/9 WU42-04: validation evidence, not agent assertion,
 * controls resolution. A "passed" outcome resolves the defect with bound
 * evidence; a "failed" outcome returns it to the queue (still open,
 * never silently closed) with the failure evidence preserved.
 */
export function recordRemediationValidation(input: RecordValidationInput): RecordValidationOutcome {
  const { defect } = input;
  if (defect.status !== "in_progress" || !defect.remediation) {
    return {
      ok: false,
      reason: `Defect "${defect.defectId}" has no in-progress remediation to record validation against (status: "${defect.status}").`,
    };
  }

  const targetStatus = input.outcome === "passed" ? "resolved" : "queued";
  const transitionCheck = validateDefectTransition(defect.status, targetStatus);
  if (!transitionCheck.ok) {
    return { ok: false, reason: transitionCheck.reason ?? `Illegal transition to ${targetStatus}.` };
  }

  const evidenceRef = {
    evidenceRefId: `DEFEV-VAL-${input.now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    sourceKind: "human_reported" as const,
    locator: input.evidenceLocator,
    capturedAt: input.now,
    description: input.note,
  };

  const remediationEvidence: RemediationEvidence = {
    remediationId: defect.remediation.remediationId,
    validationOutcome: input.outcome === "passed" ? "passed" : "failed",
    evidenceRefs: [evidenceRef],
    recordedAt: input.now,
    note: input.note,
  };

  const updatedRemediation: RemediationDecision = {
    ...defect.remediation,
    outcome: input.outcome === "passed" ? "validation_passed" : "validation_failed",
    updatedAt: input.now,
  };

  const updated: DefectRecord = {
    ...defect,
    status: targetStatus,
    remediation: updatedRemediation,
    remediationEvidence: [...(defect.remediationEvidence ?? []), remediationEvidence],
    resolution:
      input.outcome === "passed"
        ? { resolvedAt: input.now, evidenceRefs: [evidenceRef], note: input.note }
        : defect.resolution,
    updatedAt: input.now,
  };

  return { ok: true, defect: updated, transition: { from: defect.status, to: targetStatus } };
}
