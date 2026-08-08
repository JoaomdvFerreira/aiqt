import type {
  DefectConfidence,
  DefectRecord,
  DefectSeverity,
  DefectTriageDecision,
} from "../schema/defect.schema.js";

/**
 * M42-WU03 §6: deterministic triage. Pure function of the defect's own
 * canonical fields plus `now` -- identical inputs always produce an
 * identical decision (Definition of Done item 7). Never reads a clock
 * internally, never calls an LLM; severity/confidence/reproducibility/
 * priority/disposition/approvalAuthority are all derived from fixed,
 * literal rules only.
 */

const SEVERITY_WEIGHT: Readonly<Record<DefectSeverity, number>> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 10,
};

const CONFIDENCE_WEIGHT: Readonly<Record<DefectConfidence, number>> = {
  confirmed: 20,
  probable: 10,
  suspected: 0,
  insufficient_evidence: -30,
};

const CONFIDENCE_DOWNGRADE: Readonly<Record<DefectConfidence, DefectConfidence>> = {
  confirmed: "probable",
  probable: "suspected",
  suspected: "insufficient_evidence",
  insufficient_evidence: "insufficient_evidence",
};

/**
 * Section 5's freshness rule reaches triage here: stale evidence cannot
 * confirm current reproducibility, so it is downgraded exactly one level
 * (never silently treated as a current confirmation).
 */
function deriveReproducibility(defect: DefectRecord): { reproducibility: DefectConfidence; downgraded: boolean } {
  if (defect.freshness.state === "stale") {
    return { reproducibility: CONFIDENCE_DOWNGRADE[defect.confidence], downgraded: true };
  }
  return { reproducibility: defect.confidence, downgraded: false };
}

function computeAgeBonus(createdAt: string, now: string): number {
  const createdMs = Date.parse(createdAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(createdMs) || Number.isNaN(nowMs) || nowMs <= createdMs) return 0;
  const ageDays = (nowMs - createdMs) / 86_400_000;
  // Section 6.2: age is a lower-priority tie-breaker only -- capped small
  // enough it can never outweigh a severity or confidence tier.
  return Math.min(ageDays, 30) * 0.01;
}

export interface TriageDecisionInput {
  defect: DefectRecord;
  isActiveWorkUnit: boolean;
  now: string;
}

export function computeTriageDecision(input: TriageDecisionInput): DefectTriageDecision {
  const { defect, isActiveWorkUnit, now } = input;
  const { reproducibility, downgraded } = deriveReproducibility(defect);

  const reasonCodes: string[] = [`SEVERITY_${defect.severity.toUpperCase()}`, `CONFIDENCE_${defect.confidence.toUpperCase()}`];
  const evidenceGaps: string[] = [];

  if (downgraded) {
    reasonCodes.push("STALE_EVIDENCE_REPRODUCIBILITY_DOWNGRADED");
    evidenceGaps.push("Evidence is stale (superseded by a newer checkpoint); reproducibility could not be confirmed as current.");
  }
  if (isActiveWorkUnit) {
    reasonCodes.push("ACTIVE_WORK_UNIT_RELEVANCE");
  }

  let queueDisposition: DefectTriageDecision["queueDisposition"];
  let recommendedNextAction: string;

  if (reproducibility === "insufficient_evidence") {
    queueDisposition = "needs_human";
    reasonCodes.push("INSUFFICIENT_EVIDENCE");
    evidenceGaps.push("Confidence/reproducibility is insufficient to justify an automated remediation decision.");
    recommendedNextAction = "Gather stronger/current evidence, or have a human confirm the defect, before queueing.";
  } else if (reproducibility === "suspected" && (defect.severity === "critical" || defect.severity === "high")) {
    queueDisposition = "needs_human";
    reasonCodes.push("HIGH_SEVERITY_LOW_CONFIDENCE_AMBIGUOUS");
    evidenceGaps.push(`Severity is ${defect.severity} but confidence is only "suspected" -- the side effect of queueing cannot be safely justified without human review.`);
    recommendedNextAction = "A human should confirm this high/critical-severity defect before it is queued for remediation.";
  } else if ((defect.severity === "low" || defect.severity === "info") && reproducibility !== "confirmed") {
    queueDisposition = "defer";
    reasonCodes.push("LOW_SEVERITY_NOT_CONFIRMED_DEFERRED");
    recommendedNextAction = "Low-impact and not yet confirmed; deferred pending stronger evidence or explicit human priority.";
  } else {
    queueDisposition = "queue";
    recommendedNextAction = "Eligible for the remediation queue.";
  }

  const approvalAuthority = queueDisposition === "needs_human" ? "human_required" : "automation";

  const priorityRaw =
    SEVERITY_WEIGHT[defect.severity] +
    CONFIDENCE_WEIGHT[reproducibility] +
    (isActiveWorkUnit ? 15 : 0) +
    (defect.freshness.state === "stale" ? -10 : 0) +
    computeAgeBonus(defect.createdAt, now);
  const priority = Math.max(0, Math.round(priorityRaw));

  return {
    severity: defect.severity,
    confidence: defect.confidence,
    reproducibility,
    priority,
    queueDisposition,
    approvalAuthority,
    reasonCodes,
    evidenceGaps,
    recommendedNextAction,
    decidedAt: now,
  };
}

/**
 * Section 6.2: deterministic queue ordering for identical canonical inputs
 * -- priority descending, then age ascending (older first, the documented
 * tie-breaker), then defectId ascending as a final total-order tie-breaker
 * so sort output never depends on input array order or engine stability.
 */
export function sortByQueuePriority(defects: readonly DefectRecord[]): DefectRecord[] {
  return [...defects].sort((a, b) => {
    const pa = a.triage?.priority ?? -1;
    const pb = b.triage?.priority ?? -1;
    if (pa !== pb) return pb - pa;
    const ca = Date.parse(a.createdAt);
    const cb = Date.parse(b.createdAt);
    if (ca !== cb) return ca - cb;
    return a.defectId.localeCompare(b.defectId);
  });
}
