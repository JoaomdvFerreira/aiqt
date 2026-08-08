import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { readOwnerMap } from "../structural-review-evidence.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Section 4.1: owner-map primary/supporting paths that no longer exist
 * on disk -- deterministically provable (Section 3.5's "invalid
 * owner-map references" example). The owner map is an index, not source
 * authority (build spec Sec 4.1): this rule only ever flags a path that
 * genuinely does not exist, never infers drift from map content alone.
 */
export function runOwnerMapPathValidationRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const ownerMap = readOwnerMap(repoRoot);
  if (!ownerMap) return [];

  const findings: StructuralFinding[] = [];
  for (const [domainKey, entry] of Object.entries(ownerMap.entries)) {
    const missing: string[] = [];
    if (entry.primary && !existsSync(join(repoRoot, entry.primary))) missing.push(entry.primary);
    for (const supportingPath of entry.supporting ?? []) {
      if (!existsSync(join(repoRoot, supportingPath))) missing.push(supportingPath);
    }
    if (missing.length === 0) continue;

    findings.push(
      buildStructuralFinding({
        domain: "ownership_divergence",
        ruleId: "owner-map-path-missing",
        title: `Owner map entry "${domainKey}" references a missing path`,
        explanation: `repository-owner-map.json's "${domainKey}" entry lists ${missing.length} path(s) that do not exist in the current working tree: ${missing.join(", ")}.`,
        reviewCommit,
        affectedPaths: missing,
        affectedOwners: [domainKey],
        evidence: missing.map((path, i) => ({
          evidenceId: `OWNER-MAP-MISSING-${i}`,
          description: `Path listed in owner map entry "${domainKey}" does not exist on disk.`,
          locator: path,
        })),
        confidence: "proven",
        significance: "medium",
        reasonCodes: ["OWNER_MAP_PATH_MISSING"],
        disposition: "actionable",
        eligibleForIntake: true,
        recommendedNextAction: `Update or remove the "${domainKey}" owner-map entry, or restore the missing path(s).`,
        evidenceSignature: `${domainKey}::${missing.sort().join(",")}`,
      }),
    );
  }
  return findings;
}
