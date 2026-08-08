import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { listSourceFiles, readRepoFileLines } from "../structural-review-evidence.js";

/** Repository-relative hotspot detection: only files well beyond the distribution's own spread are flagged. */
const MIN_LINES_TO_CONSIDER = 200;
const STDDEV_MULTIPLIER = 3;

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values: readonly number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Section 4.3: a measurable, repository-relative hotspot signal. File
 * length alone is never high-confidence (build spec: "File length alone
 * must not produce a high-confidence defect") -- this rule always emits
 * `weak_signal` confidence and a non-actionable-by-default disposition,
 * explicitly recommending human inspection rather than asserting a
 * defect.
 */
export function runResponsibilityConcentrationRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const files = listSourceFiles(repoRoot).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const lineCounts = new Map<string, number>();
  for (const file of files) {
    const lines = readRepoFileLines(repoRoot, file);
    if (lines) lineCounts.set(file, lines.length);
  }

  const values = [...lineCounts.values()];
  if (values.length < 10) return [];

  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const spread = stddev(values, mean);
  const threshold = Math.max(MIN_LINES_TO_CONSIDER, med + STDDEV_MULTIPLIER * spread);

  const findings: StructuralFinding[] = [];
  for (const [file, count] of lineCounts) {
    if (count <= threshold) continue;
    findings.push(
      buildStructuralFinding({
        domain: "responsibility_concentration",
        ruleId: "module-line-count-hotspot",
        title: `${file} is a repository-relative size outlier`,
        explanation: `${file} has ${count} lines, exceeding this repository's own median (${Math.round(med)}) by more than ${STDDEV_MULTIPLIER} standard deviations (threshold: ${Math.round(threshold)}). Size alone does not prove excess responsibility -- manual inspection is required.`,
        reviewCommit,
        affectedPaths: [file],
        evidence: [{ evidenceId: "LINE-COUNT", description: `${count} lines vs. repository median ${Math.round(med)}, threshold ${Math.round(threshold)}.`, locator: file }],
        confidence: "weak_signal",
        significance: "low",
        reasonCodes: ["SIZE_OUTLIER"],
        evidenceGaps: ["Responsibility concentration was not independently verified by reading the file's actual exported surface."],
        disposition: "informational",
        eligibleForIntake: false,
        recommendedNextAction: "Manually review the file's responsibilities before considering a split; size alone does not justify one.",
        evidenceSignature: `${file}::${count}`,
      }),
    );
  }
  return findings;
}
