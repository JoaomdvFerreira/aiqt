import type { StructuralFinding } from "../schema/structural-review.schema.js";

/**
 * Section 6.1: deterministic consolidation. Findings sharing the same
 * `findingKey` (identical domain+rule+structural-evidence identity,
 * never merely similar titles -- build spec: "Do not collapse findings
 * only because human-readable titles look similar") are folded into one,
 * union-merging evidence (deduped by evidenceId) and recording every
 * folded-in rule/provider source in `consolidatedFrom` so provenance is
 * never silently discarded.
 */
export function consolidateFindings(findings: readonly StructuralFinding[]): StructuralFinding[] {
  const byKey = new Map<string, StructuralFinding>();

  for (const finding of findings) {
    const existing = byKey.get(finding.findingKey);
    if (!existing) {
      byKey.set(finding.findingKey, finding);
      continue;
    }

    const evidenceById = new Map(existing.evidence.map((e) => [e.evidenceId, e]));
    for (const e of finding.evidence) {
      if (!evidenceById.has(e.evidenceId)) evidenceById.set(e.evidenceId, e);
    }

    const consolidatedFrom = [
      ...new Set([...(existing.consolidatedFrom ?? [existing.providerSource]), finding.providerSource]),
    ];

    byKey.set(finding.findingKey, {
      ...existing,
      evidence: [...evidenceById.values()],
      affectedPaths: [...new Set([...existing.affectedPaths, ...finding.affectedPaths])],
      reasonCodes: [...new Set([...existing.reasonCodes, ...finding.reasonCodes])],
      evidenceGaps: [...new Set([...existing.evidenceGaps, ...finding.evidenceGaps])],
      consolidatedFrom,
    });
  }

  return [...byKey.values()];
}

/**
 * Section 6.2: known-benign structural shapes that must never be
 * promoted to an actionable finding even if some future rule's raw
 * signal would otherwise match them. Belt-and-suspenders alongside each
 * rule's own scoping (e.g. execution-safety-boundary already excludes
 * src/tooling/**) -- this is the one shared, auditable suppression list
 * every consolidated finding passes through.
 */
const BENIGN_PATH_PATTERNS: readonly RegExp[] = [
  /^docs\/archive\//, // archived milestone documents referencing historical paths (Section 6.2)
  /-legacy-compat\.test\.ts$/, // historical compatibility fixtures retained specifically for compatibility (Section 6.2)
  /historical-compatibility\.test\.ts$/,
];

export function suppressKnownBenignFindings(findings: readonly StructuralFinding[]): StructuralFinding[] {
  return findings.map((finding) => {
    const isBenign = finding.affectedPaths.every((p) => BENIGN_PATH_PATTERNS.some((pattern) => pattern.test(p)));
    if (!isBenign || finding.affectedPaths.length === 0) return finding;
    return {
      ...finding,
      disposition: "suppressed_benign_pattern" as const,
      eligibleForIntake: false,
      reasonCodes: [...new Set([...finding.reasonCodes, "SUPPRESSED_KNOWN_BENIGN_PATTERN"])],
      recommendedNextAction: "No action -- this matches a known benign structural pattern (archived history or a retained compatibility fixture).",
    };
  });
}
