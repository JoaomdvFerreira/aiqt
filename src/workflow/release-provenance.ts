import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type {
  ReleaseBlockingFinding,
  ReleaseCandidate,
  ReleaseEvidenceStatus,
  ReleaseProvenance,
} from "../schema/release-governance.schema.js";

/**
 * M40-WU01 (build spec Sec 6.1): binds a release candidate to the exact
 * evidence facts available for it and computes a deterministic digest over
 * those canonical inputs. Reuses the M23 canonical-JSON digest primitive
 * directly rather than duplicating a hashing strategy.
 */

export interface ReleaseProvenanceFacts {
  ciCommit: string | null;
  ciRunIdentity: string | null;
  ciStatus: ReleaseEvidenceStatus;
  validationEvidenceDigest: string | null;
  securityEvidenceStatus: ReleaseEvidenceStatus;
  releaseNotesDigest: string | null;
  riskAssessmentVersion: string | null;
  approvalAuthorityDecision: string | null;
}

/** Every field that participates in the provenance digest, in a stable, explicit shape (order-independent -- canonicalJsonStringify sorts keys). */
function digestInputs(candidate: ReleaseCandidate, facts: ReleaseProvenanceFacts) {
  return {
    candidateCommit: candidate.identity.candidateCommit,
    ciCommit: facts.ciCommit,
    ciRunIdentity: facts.ciRunIdentity,
    ciStatus: facts.ciStatus,
    packageVersion: candidate.identity.packageVersion,
    schemaVersion: candidate.identity.schemaVersion,
    intendedReleaseTag: candidate.identity.intendedReleaseTag,
    baseRelease: candidate.identity.baseRelease,
    includedMilestoneIds: candidate.milestones.map((m) => m.milestoneId),
    includedMilestoneTags: candidate.milestones.map((m) => m.tag),
    includedMilestoneClosureCommits: candidate.milestones.map((m) => m.closureCommit),
    validationEvidenceDigest: facts.validationEvidenceDigest,
    securityEvidenceStatus: facts.securityEvidenceStatus,
    releaseNotesDigest: facts.releaseNotesDigest,
    riskAssessmentVersion: facts.riskAssessmentVersion,
    approvalAuthorityDecision: facts.approvalAuthorityDecision,
  };
}

/** Deterministic for identical canonical inputs (build spec Sec 6.1). */
export function computeReleaseProvenanceDigest(candidate: ReleaseCandidate, facts: ReleaseProvenanceFacts): string {
  return computeCanonicalPayloadDigest(digestInputs(candidate, facts));
}

export function buildReleaseProvenance(candidate: ReleaseCandidate, facts: ReleaseProvenanceFacts): ReleaseProvenance {
  return {
    candidateCommit: candidate.identity.candidateCommit,
    ciCommit: facts.ciCommit,
    ciRunIdentity: facts.ciRunIdentity,
    ciStatus: facts.ciStatus,
    packageVersion: candidate.identity.packageVersion,
    schemaVersion: candidate.identity.schemaVersion,
    intendedReleaseTag: candidate.identity.intendedReleaseTag,
    baseRelease: candidate.identity.baseRelease,
    includedMilestoneIds: candidate.milestones.map((m) => m.milestoneId),
    includedMilestoneTags: candidate.milestones.map((m) => m.tag),
    includedMilestoneClosureCommits: candidate.milestones.map((m) => m.closureCommit),
    closureReportDigests: candidate.milestones.map(() => null),
    validationEvidenceDigest: facts.validationEvidenceDigest,
    securityEvidenceStatus: facts.securityEvidenceStatus,
    releaseNotesDigest: facts.releaseNotesDigest,
    riskAssessmentVersion: facts.riskAssessmentVersion,
    approvalAuthorityDecision: facts.approvalAuthorityDecision,
    digest: computeReleaseProvenanceDigest(candidate, facts),
  };
}

/**
 * A mismatch between candidate commit, CI commit, or per-milestone tag/
 * closure-commit provenance must fail closed with an explicit blocking
 * finding (build spec Sec 6.1) -- never silently ignored.
 */
export function detectProvenanceMismatches(candidate: ReleaseCandidate, provenance: ReleaseProvenance): ReleaseBlockingFinding[] {
  const findings: ReleaseBlockingFinding[] = [];

  if (provenance.ciCommit !== null && provenance.ciCommit !== provenance.candidateCommit) {
    findings.push({
      id: "RELEASE-PROVENANCE-CI-COMMIT-MISMATCH",
      area: "provenance",
      message: `CI commit "${provenance.ciCommit}" does not match candidate commit "${provenance.candidateCommit}".`,
      evidenceKey: "ci",
    });
  }

  for (const m of candidate.milestones) {
    if (m.tagCommit !== null && m.closureCommit !== null && m.tagCommit !== m.closureCommit) {
      findings.push({
        id: "RELEASE-PROVENANCE-MILESTONE-TAG-CLOSURE-MISMATCH",
        area: "provenance",
        message: `Milestone "${m.milestoneId}" tag "${m.tag}" resolves to commit "${m.tagCommit}", which does not match its declared closure commit "${m.closureCommit}".`,
        evidenceKey: `milestone:${m.milestoneId}`,
      });
    }
  }

  return findings;
}
