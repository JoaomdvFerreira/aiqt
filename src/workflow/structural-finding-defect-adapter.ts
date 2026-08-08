import type { StructuralFinding } from "../schema/structural-review.schema.js";
import type { DefectConfidence, DefectSeverity } from "../schema/defect.schema.js";
import type { DiscoveryCandidate } from "./defect-discovery.js";

/**
 * Section 3.3/8 WU43-04: the bounded defect-evidence adapter. Converts
 * one M43 StructuralFinding into an M42 DiscoveryCandidate so intake can
 * reuse M42's existing discovery/dedup/fingerprint/triage owners
 * verbatim (`applyDiscoveryCandidates`) -- no parallel defect pipeline.
 * `sourceKind: "review_finding"` is the source M42-WU02 deliberately
 * reserved as explicitly unsupported (Section 5's "narrowest practical
 * subset"); M43 is the milestone that implements it.
 *
 * Structural significance/confidence are separate domains from defect
 * severity/confidence (Section 3.7) -- these mappings are a one-time,
 * explicit translation at the intake boundary, not a claim that the
 * two scales are the same thing. M42's own triage (run separately,
 * after intake) remains the sole owner of the defect's actual severity/
 * confidence going forward; nothing here bypasses that.
 */

const SIGNIFICANCE_TO_SEVERITY: Readonly<Record<StructuralFinding["significance"], DefectSeverity>> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  informational: "info",
};

const CONFIDENCE_TO_DEFECT_CONFIDENCE: Readonly<Record<StructuralFinding["confidence"], DefectConfidence>> = {
  proven: "confirmed",
  strong_signal: "probable",
  weak_signal: "suspected",
  unsupported: "insufficient_evidence",
};

export function structuralFindingToDiscoveryCandidate(finding: StructuralFinding, now: string): DiscoveryCandidate {
  return {
    title: finding.title,
    summary: finding.explanation,
    sourceKind: "review_finding",
    evidenceRef: {
      sourceKind: "review_finding",
      locator: `structural-review:${finding.domain}/${finding.ruleId}::${finding.findingKey}`,
      capturedAt: now,
      description: finding.recommendedNextAction,
    },
    severity: SIGNIFICANCE_TO_SEVERITY[finding.significance],
    confidence: CONFIDENCE_TO_DEFECT_CONFIDENCE[finding.confidence],
    freshness: { state: "current", evaluatedAt: now },
    fingerprintInput: {
      sourceKind: "review_finding",
      evidenceSignature: finding.findingKey,
    },
  };
}
