import type { EvidenceRecord } from "../schema/evidence.schema.js";
import { EvidenceRecordSchema } from "../schema/evidence.schema.js";
import type { NormalizedEvidenceSnapshotEntry } from "../schema/evidence-gate-simulation.schema.js";

/**
 * M28 §5.5: every evidence record's canonical scope-ref set, derived only
 * from existing, explicit relationships (workflowBinding.workUnitId/
 * checkpointId, and the project identity) -- never a heuristic
 * association by title, timestamp, path, or summary.
 */
export function scopeRefsForRecord(record: EvidenceRecord, projectId: string): string[] {
  const refs = [`project:${projectId}`, `work_unit:${record.workflowBinding.workUnitId}`];
  if (record.workflowBinding.checkpointId) {
    refs.push(`checkpoint:${record.workflowBinding.checkpointId}`);
  }
  return refs.sort();
}

/**
 * M28 §5.7.1: normalizes one evidence record into its digest-relevant
 * projection. A record is `invalid` when it carries zero artifact
 * references with a recognized canonical kind, or fails re-validation
 * against the canonical EvidenceRecordSchema (defensive corruption
 * check) -- both cases are conservative and structural, never inferred.
 */
export function normalizeEvidenceRecord(record: EvidenceRecord, projectId: string): NormalizedEvidenceSnapshotEntry {
  const revalidated = EvidenceRecordSchema.safeParse(record);
  const artifactKinds = Array.from(new Set(record.artifactReferences.map((ref) => ref.kind))).sort();
  const referenceValidity: "valid" | "invalid" = revalidated.success && artifactKinds.length > 0 ? "valid" : "invalid";

  return {
    evidenceId: record.evidenceId,
    trust: record.provider.trustLevel,
    scopeRefs: scopeRefsForRecord(record, projectId),
    artifactKinds,
    freshnessTimestamp: isValidIsoTimestamp(record.recordedAt) ? record.recordedAt : null,
    referenceValidity,
  };
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * M28 §5.7.1: the full, sorted, normalized evidence snapshot for a
 * project. Every evidence record carries a universal "project:<id>"
 * scope-ref (M28-WU01 Gate H's scope-resolution conclusion), so the
 * complete project evidence pool is always the correct input snapshot --
 * actual target/scope-mode filtering happens during rule evaluation
 * (WU28-03's engine), never here. Duplicate evidenceIds (which cannot
 * occur through any existing canonical write path) are defensively
 * rejected rather than silently collapsed.
 */
export function buildEvidenceSnapshotEntries(records: readonly EvidenceRecord[], projectId: string): NormalizedEvidenceSnapshotEntry[] {
  const entries = records.map((r) => normalizeEvidenceRecord(r, projectId));
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.evidenceId)) {
      throw new Error(`Duplicate evidenceId "${entry.evidenceId}" in canonical evidence state -- invalid canonical state.`);
    }
    seen.add(entry.evidenceId);
  }
  return entries.slice().sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}
