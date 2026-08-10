import type { AuditFinding } from "../schema/night-audit.schema.js";
import type { DefectConfidence, DefectSeverity } from "../schema/defect.schema.js";
import type { DiscoveryCandidate } from "./defect-discovery.js";

/**
 * M48-WU04 (build spec Sec 7): the bounded defect-evidence adapter,
 * mirroring structural-finding-defect-adapter.ts exactly. Converts one
 * AuditFinding into an M42 DiscoveryCandidate so intake can reuse M42's
 * existing discovery/dedup/fingerprint/triage owners verbatim
 * (`applyDiscoveryCandidates`) -- no parallel defect pipeline.
 * `sourceKind: "review_finding"` is the same source M43 already uses;
 * M48 does not add a new DefectSourceKind.
 *
 * AuditFinding significance/confidence are separate domains from defect
 * severity/confidence (mirrors M43's own "one-time, explicit translation
 * at the intake boundary" discipline) -- M42's own triage, run separately
 * after intake, remains the sole owner of the defect's actual
 * severity/confidence going forward.
 */

const SIGNIFICANCE_TO_SEVERITY: Readonly<Record<AuditFinding["significance"], DefectSeverity>> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  informational: "info",
};

const CONFIDENCE_TO_DEFECT_CONFIDENCE: Readonly<Record<AuditFinding["confidence"], DefectConfidence>> = {
  proven: "confirmed",
  strong_signal: "probable",
  weak_signal: "suspected",
  unsupported: "insufficient_evidence",
};

/**
 * `fingerprintInput.evidenceSignature` reuses the AuditFinding's own
 * `findingKey` (a structural digest that already excludes narrative text
 * and the reviewed commit), exactly as M43's adapter reuses
 * `finding.findingKey` -- never a second, independent evidence signature.
 */
export function auditFindingToDiscoveryCandidate(finding: AuditFinding, now: string): DiscoveryCandidate {
  return {
    title: finding.title,
    summary: finding.explanation,
    sourceKind: "review_finding",
    evidenceRef: {
      sourceKind: "review_finding",
      locator: `night-audit:${finding.domain}/${finding.checkId}::${finding.findingKey}`,
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
