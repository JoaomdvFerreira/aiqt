import type { DefectRecord } from "../schema/defect.schema.js";
import { MAX_DEFECTS, MAX_EVIDENCE_REFS_PER_DEFECT } from "../schema/defect.schema.js";
import { nextId } from "../state/ids.js";
import { fingerprintCandidate, type DiscoveryCandidate } from "../workflow/defect-discovery.js";

export interface DiscoveryApplyResult {
  defects: DefectRecord[];
  created: DefectRecord[];
  enriched: { defectId: string; fingerprint: string }[];
  skippedAtCap: DiscoveryCandidate[];
}

/**
 * Section 4.3: deterministic, evidence-based dedup. An exact fingerprint
 * match enriches the existing canonical record (new evidence ref appended,
 * `updatedAt`/freshness refreshed, history preserved) instead of creating a
 * new queue entry -- regardless of the existing record's current status,
 * so an `invalid` disposition is never silently reopened by new matching
 * evidence (Section 4.3, dogfood scenario 7). A candidate whose fingerprint
 * does not match any existing defect becomes a new `candidate`-status
 * record. Fails closed (skips, never silently drops past MAX_DEFECTS) once
 * the canonical defect cap is reached.
 */
export function applyDiscoveryCandidates(
  existingDefects: readonly DefectRecord[],
  candidates: readonly DiscoveryCandidate[],
  now: string,
): DiscoveryApplyResult {
  const byFingerprint = new Map<string, DefectRecord>();
  const defects = existingDefects.map((d) => {
    byFingerprint.set(d.fingerprint, d);
    return d;
  });

  const created: DefectRecord[] = [];
  const enriched: { defectId: string; fingerprint: string }[] = [];
  const skippedAtCap: DiscoveryCandidate[] = [];
  let refCounter = 0;

  for (const candidate of candidates) {
    const fingerprint = fingerprintCandidate(candidate);
    const existing = byFingerprint.get(fingerprint);
    refCounter += 1;
    const evidenceRefId = `DEFEV-${String(refCounter).padStart(4, "0")}-${fingerprint.slice(7, 15)}`;
    const evidenceRef = { ...candidate.evidenceRef, evidenceRefId };

    if (existing) {
      const nextRefs = [...existing.evidenceRefs, evidenceRef];
      const boundedRefs =
        nextRefs.length > MAX_EVIDENCE_REFS_PER_DEFECT
          ? nextRefs.slice(nextRefs.length - MAX_EVIDENCE_REFS_PER_DEFECT)
          : nextRefs;
      const updated: DefectRecord = {
        ...existing,
        evidenceRefs: boundedRefs,
        freshness: candidate.freshness,
        updatedAt: now,
      };
      const idx = defects.findIndex((d) => d.defectId === existing.defectId);
      defects[idx] = updated;
      byFingerprint.set(fingerprint, updated);
      enriched.push({ defectId: existing.defectId, fingerprint });
      continue;
    }

    if (defects.length >= MAX_DEFECTS) {
      skippedAtCap.push(candidate);
      continue;
    }

    const defectId = nextId("DEF", defects.map((d) => d.defectId));
    const record: DefectRecord = {
      defectId,
      title: candidate.title,
      summary: candidate.summary,
      sourceKind: candidate.sourceKind,
      evidenceRefs: [evidenceRef],
      fingerprint,
      severity: candidate.severity,
      confidence: candidate.confidence,
      affectedMilestoneId: candidate.affectedMilestoneId,
      affectedWorkUnitId: candidate.affectedWorkUnitId,
      affectedValidationTargets: candidate.affectedValidationTargets,
      status: "candidate",
      freshness: candidate.freshness,
      createdAt: now,
      updatedAt: now,
    };
    defects.push(record);
    byFingerprint.set(fingerprint, record);
    created.push(record);
  }

  return { defects, created, enriched, skippedAtCap };
}
