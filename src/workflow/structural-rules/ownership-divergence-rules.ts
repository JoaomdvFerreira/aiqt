import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { listSourceFiles, readOwnerMap, readRepoFileText } from "../structural-review-evidence.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TOP_LEVEL_EXPORT_PATTERN = /^export\s+(?:function|const|class)\s+([A-Za-z0-9_]+)/gm;

function extractTopLevelExportNames(text: string): Set<string> {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  TOP_LEVEL_EXPORT_PATTERN.lastIndex = 0;
  while ((match = TOP_LEVEL_EXPORT_PATTERN.exec(text)) !== null) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Section 4.1: "multiple modules independently implementing a decision
 * that governance says has one owner." Bounded to the owner map's own
 * governed vocabulary -- for each entry's `primary` file, checks whether
 * any OTHER source file (outside that entry's own primary+supporting
 * set) exports a top-level function/const/class of the exact same name.
 * A name collision is `strong_signal`, not `proven` -- the same
 * identifier does not by itself prove behavioral duplication, only that
 * it warrants a governance-owner look.
 */
export function runDuplicateDecisionOwnerRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const ownerMap = readOwnerMap(repoRoot);
  if (!ownerMap) return [];

  const allSourceFiles = listSourceFiles(repoRoot).filter((f) => !f.endsWith(".test.ts"));

  // Build the exported-name -> files index ONCE (O(files)), instead of
  // re-reading/re-scanning every source file per owner-map entry --
  // O(owner-entries * files) was a real, found-and-fixed performance
  // defect (full-suite timeout) in this rule's first draft.
  const nameToFiles = new Map<string, string[]>();
  for (const file of allSourceFiles) {
    const text = readRepoFileText(repoRoot, file);
    if (text === null) continue;
    for (const name of extractTopLevelExportNames(text)) {
      const list = nameToFiles.get(name);
      if (list) list.push(file);
      else nameToFiles.set(name, [file]);
    }
  }

  const findings: StructuralFinding[] = [];
  for (const [domainKey, entry] of Object.entries(ownerMap.entries)) {
    if (!entry.primary || !existsSync(join(repoRoot, entry.primary))) continue;
    const primaryText = readRepoFileText(repoRoot, entry.primary);
    if (primaryText === null) continue;
    const governedNames = extractTopLevelExportNames(primaryText);
    if (governedNames.size === 0) continue;

    const ownedFiles = new Set([entry.primary, ...(entry.supporting ?? [])]);
    const collisionsByFile = new Map<string, string[]>();
    for (const name of governedNames) {
      for (const file of nameToFiles.get(name) ?? []) {
        if (ownedFiles.has(file)) continue;
        const list = collisionsByFile.get(file);
        if (list) list.push(name);
        else collisionsByFile.set(file, [name]);
      }
    }

    for (const [otherFile, collisions] of collisionsByFile) {
      findings.push(
        buildStructuralFinding({
          domain: "ownership_divergence",
          ruleId: "duplicate-decision-owner-implementation",
          title: `${otherFile} re-declares symbol(s) governed by "${domainKey}"`,
          explanation: `${otherFile} exports ${collisions.join(", ")}, the same top-level identifier name(s) already governed by owner-map entry "${domainKey}" (${entry.primary}). This may be an independent, divergent implementation of the same decision, or an unrelated naming coincidence.`,
          reviewCommit,
          affectedPaths: [entry.primary, otherFile],
          affectedOwners: [domainKey],
          evidence: collisions.map((name, i) => ({
            evidenceId: `DUP-SYMBOL-${i}`,
            description: `"${name}" exported by both ${entry.primary} and ${otherFile}.`,
            locator: otherFile,
          })),
          confidence: "strong_signal",
          significance: "medium",
          reasonCodes: ["DUPLICATE_DECISION_OWNER_SYMBOL"],
          evidenceGaps: ["Behavioral equivalence of the two implementations was not verified -- only identifier-name collision."],
          disposition: "actionable",
          eligibleForIntake: true,
          recommendedNextAction: `Confirm whether ${otherFile} duplicates "${domainKey}"'s governed decision; consolidate to the owner or delegate rather than reimplementing.`,
          evidenceSignature: `${domainKey}::${otherFile}::${collisions.sort().join(",")}`,
        }),
      );
    }
  }
  return findings;
}

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
