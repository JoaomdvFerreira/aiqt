import type { AuditFinding } from "../schema/night-audit.schema.js";

/**
 * M48-WU04 (build spec Sec 8): a pure, deterministic quality gate.
 * Evaluated identically regardless of which ReviewTask or domain produced
 * the finding -- no finding is published merely because an agent (or the
 * structural call-through) asserted it.
 */
export type AuditFindingGateDecision = "accept" | "reject";

export interface AuditFindingGateResult {
  decision: AuditFindingGateDecision;
  reasons: string[];
}

const REJECTABLE_CONFIDENCE: ReadonlySet<AuditFinding["confidence"]> = new Set(["weak_signal", "unsupported"]);

/**
 * Rejects when: disposition is not "actionable"; evidence is empty;
 * confidence is below "strong_signal" (i.e. "weak_signal"/"unsupported");
 * or significance is "informational" (no governance opt-in exists for
 * that class at M48). All applicable reasons are reported, not just the
 * first, so a rejected finding's log is fully explainable.
 */
export function evaluateAuditFinding(finding: Pick<AuditFinding, "disposition" | "confidence" | "significance" | "evidence">): AuditFindingGateResult {
  const reasons: string[] = [];

  if (finding.disposition !== "actionable") {
    reasons.push(`disposition "${finding.disposition}" is not actionable.`);
  }
  if (finding.evidence.length === 0) {
    reasons.push("no evidence items were supplied.");
  }
  if (REJECTABLE_CONFIDENCE.has(finding.confidence)) {
    reasons.push(`confidence "${finding.confidence}" is below the strong_signal floor.`);
  }
  if (finding.significance === "informational") {
    reasons.push('significance "informational" is not publishable (no governance opt-in exists for this class).');
  }

  return { decision: reasons.length === 0 ? "accept" : "reject", reasons };
}
