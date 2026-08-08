import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { ReleaseIntentRequest } from "../services/release-governance-service.js";
import { renderReleaseNotesMarkdown, type ReadyReleaseDecision } from "./release-notes.js";
import type {
  HistoricalEvidenceConflict,
  HistoricalEvidenceItem,
  HistoricalReleaseTarget,
  ReconstructionAssessment,
  ReconstructionStatus,
} from "../schema/historical-reconstruction.schema.js";

/**
 * M44-WU03: the pure reconstruction-quality decision and the M40-candidate
 * mapping. No Git/file/network access -- everything here operates on the
 * already-collected evidence ledger from historical-evidence.ts /
 * historical-reconstruction-service.ts (WU44-02). This module never
 * re-implements M40's readiness/risk/approval/notes engines; it only
 * translates historical evidence into the exact input shape those engines
 * already accept (ReleaseIntentRequest) and reuses renderReleaseNotesMarkdown
 * verbatim for retrospective notes.
 */

const SCHEMA_VERSION_EVIDENCE_KEY = "schema_version_at_commit";

/**
 * Reconstruction-quality outcome (build spec Sec 6.4). `existing_release`
 * is never produced here -- that outcome depends on the bounded external
 * GitHub lookup owned by WU44-04, which layers on top of this status when
 * it determines a published release already exists for the target.
 */
export function computeReconstructionStatus(
  target: HistoricalReleaseTarget,
  evidence: readonly HistoricalEvidenceItem[],
  conflicts: readonly HistoricalEvidenceConflict[],
): ReconstructionStatus {
  if (conflicts.length > 0) return "conflicting";
  if (target.packageVersionAtCommit === null) return "insufficient_evidence";
  if (target.baseReleaseAmbiguous) return "partial";

  // schema-version absence is expected and not degrading for non-AIQT-managed
  // projects (build spec Sec 7.1 "when relevant") -- excluded from the
  // warning count on purpose.
  const hasWarningEvidence = evidence.some(
    (e) => e.key !== SCHEMA_VERSION_EVIDENCE_KEY && (e.status === "partial" || e.status === "missing"),
  );
  if (hasWarningEvidence) return "reconstructable_with_warnings";

  return "reconstructable";
}

/** Deterministic digest over target identity + evidence + conflicts only (build spec Sec 6.5) -- never includes evaluatedAt or any other volatile presentation field. */
export function computeReconstructionDigest(
  target: HistoricalReleaseTarget,
  evidence: readonly HistoricalEvidenceItem[],
  conflicts: readonly HistoricalEvidenceConflict[],
): string {
  return computeCanonicalPayloadDigest({ target, evidence, conflicts });
}

export function buildReconstructionAssessment(
  target: HistoricalReleaseTarget,
  evidence: readonly HistoricalEvidenceItem[],
  conflicts: readonly HistoricalEvidenceConflict[],
  now: () => string = () => new Date().toISOString(),
): ReconstructionAssessment {
  return {
    target,
    evidence: [...evidence],
    conflicts: [...conflicts],
    status: computeReconstructionStatus(target, evidence, conflicts),
    digest: computeReconstructionDigest(target, evidence, conflicts),
    evaluatedAt: now(),
  };
}

/**
 * Maps a sufficiently evidenced historical target into the exact M40
 * candidate-intent input shape (build spec Sec 9) -- never a parallel
 * candidate/provenance model. Caller must not invoke this when
 * `target.packageVersionAtCommit` is null (checked by the reconstruction
 * status already reporting `insufficient_evidence` in that case).
 */
export function mapToReleaseIntentRequest(cwd: string, target: HistoricalReleaseTarget): ReleaseIntentRequest {
  if (target.packageVersionAtCommit === null || target.resolvedCommit === null) {
    throw new Error("mapToReleaseIntentRequest requires a resolved commit and package version");
  }
  return {
    cwd,
    repositoryIdentity: target.repositoryIdentity,
    packageVersion: target.packageVersionAtCommit,
    schemaVersion: target.schemaVersionAtCommit,
    intendedReleaseTag: target.requestedTag,
    candidateRef: target.resolvedCommit,
    baseRelease: target.baseRelease,
    milestones: target.milestones.map((m) => ({
      milestoneId: m.milestoneId,
      tag: m.tag,
      closureCommit: m.closureCommit,
    })),
    ciStatus: "missing",
    securityEvidenceStatus: "missing",
  };
}

/**
 * Retrospective marking (build spec Sec 10): prepends the required
 * "historical reconstruction" banner, then reuses M40's exact release-note
 * body verbatim -- never a second note format.
 */
export function renderRetrospectiveReleaseNotes(
  assessment: ReconstructionAssessment,
  decision: ReadyReleaseDecision,
  existingGithubRelease: "yes" | "no" | "unverified" = "unverified",
): string {
  const banner = [
    "> **Historical reconstruction:** YES",
    `> **Reconstruction quality:** ${assessment.status}`,
    `> **Target tag:** ${assessment.target.requestedTag}`,
    `> **Target commit:** ${assessment.target.resolvedCommit ?? "unknown"}`,
    `> **Evidence gaps:** ${assessment.evidence.filter((e) => e.status === "missing" || e.status === "partial").length}`,
    `> **Existing GitHub Release:** ${existingGithubRelease}`,
    "",
  ].join("\n");

  return banner + "\n" + renderReleaseNotesMarkdown(decision);
}
