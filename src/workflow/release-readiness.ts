import { detectProvenanceMismatches } from "./release-provenance.js";
import type {
  ReleaseBlockingFinding,
  ReleaseCandidate,
  ReleaseCandidateIntegrity,
  ReleaseProvenance,
  ReleaseReadinessAssessment,
  ReleaseWarning,
} from "../schema/release-governance.schema.js";

/**
 * M40-WU01 (build spec Sec 5.7, 8): readiness skeleton. Keeps candidate
 * integrity strictly separate from risk/approval (WU40-02 owns those) --
 * this module only ever reads already-resolved candidate/provenance facts,
 * never a caller-supplied final verdict.
 */

export interface ReleaseReadinessFacts {
  /** Whether the intended release tag already exists in Git (a real conflict). */
  tagAlreadyExists: boolean;
  /** Evidence keys the operator has explicitly declared not applicable to this candidate (build spec Sec 8). */
  declaredNotApplicable: string[];
  /** Presence of optional declarations, keyed the same way as declaredNotApplicable. Absent key == not declared at all. */
  declaredPresent: string[];
}

const CORE_EVIDENCE_KEYS = ["ci", "validation", "security"] as const;
const OPTIONAL_EVIDENCE_KEYS = ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"] as const;

function blocking(id: string, area: string, message: string, evidenceKey: string | null = null): ReleaseBlockingFinding {
  return { id, area, message, evidenceKey };
}

function warning(id: string, area: string, message: string, evidenceKey: string | null = null): ReleaseWarning {
  return { id, area, message, evidenceKey };
}

export function assessReleaseReadiness(
  candidate: ReleaseCandidate,
  provenance: ReleaseProvenance,
  facts: ReleaseReadinessFacts,
  now: () => string = () => new Date().toISOString(),
): ReleaseReadinessAssessment {
  const hardBlockers: ReleaseBlockingFinding[] = [...detectProvenanceMismatches(candidate, provenance)];
  const softBlockers: ReleaseBlockingFinding[] = [];
  const warnings: ReleaseWarning[] = [];
  const notApplicable: string[] = [...facts.declaredNotApplicable];

  if (facts.tagAlreadyExists) {
    hardBlockers.push(blocking("RELEASE-READINESS-TAG-CONFLICT", "tag", `Intended release tag "${candidate.identity.intendedReleaseTag}" already exists.`));
  }

  for (const m of candidate.milestones) {
    if (m.status === null) {
      warnings.push(warning("RELEASE-READINESS-MILESTONE-STATUS-UNKNOWN", "milestone-status", `Milestone "${m.milestoneId}" completion status could not be confirmed from live project state.`, `milestone:${m.milestoneId}`));
    } else if (m.status !== "done") {
      hardBlockers.push(blocking("RELEASE-READINESS-MILESTONE-NOT-DONE", "milestone-status", `Milestone "${m.milestoneId}" is not completed (status "${m.status}").`, `milestone:${m.milestoneId}`));
    }
    if (m.evidenceStatus === "missing") {
      softBlockers.push(blocking("RELEASE-READINESS-MILESTONE-EVIDENCE-MISSING", "evidence", `Milestone "${m.milestoneId}" has no verifiable tag/closure-commit evidence.`, `milestone:${m.milestoneId}`));
    } else if (m.evidenceStatus === "partial") {
      warnings.push(warning("RELEASE-READINESS-MILESTONE-EVIDENCE-PARTIAL", "evidence", `Milestone "${m.milestoneId}" tag/closure-commit evidence is only partially verifiable.`, `milestone:${m.milestoneId}`));
    }
  }

  if (provenance.ciStatus === "missing") {
    softBlockers.push(blocking("RELEASE-READINESS-CI-MISSING", "evidence", "No authoritative CI evidence is bound to this candidate.", "ci"));
  } else if (provenance.ciStatus === "partial" || provenance.ciStatus === "reconstructed") {
    warnings.push(warning("RELEASE-READINESS-CI-WEAK", "evidence", `CI evidence status is "${provenance.ciStatus}", not "verified".`, "ci"));
  }

  if (provenance.validationEvidenceDigest === null) {
    softBlockers.push(blocking("RELEASE-READINESS-VALIDATION-MISSING", "evidence", "No directly relevant validation evidence is bound to this candidate.", "validation"));
  }

  if (provenance.securityEvidenceStatus === "missing") {
    softBlockers.push(blocking("RELEASE-READINESS-SECURITY-MISSING", "evidence", "Security/supply-chain findings for this candidate have not been triaged.", "security"));
  } else if (provenance.securityEvidenceStatus === "partial" || provenance.securityEvidenceStatus === "reconstructed") {
    warnings.push(warning("RELEASE-READINESS-SECURITY-WEAK", "evidence", `Security/supply-chain evidence status is "${provenance.securityEvidenceStatus}", not "verified" or "waived".`, "security"));
  }

  for (const key of OPTIONAL_EVIDENCE_KEYS) {
    if (notApplicable.includes(key)) continue;
    if (!facts.declaredPresent.includes(key)) {
      warnings.push(warning(`RELEASE-READINESS-${key.toUpperCase()}-UNDECLARED`, "declaration", `"${key}" has not been declared for this candidate (neither present nor explicitly not-applicable).`, key));
    }
  }

  const blockingFindings = [...hardBlockers, ...softBlockers];

  let integrity: ReleaseCandidateIntegrity;
  if (hardBlockers.length > 0) {
    integrity = "blocked";
  } else if (softBlockers.length > 0) {
    integrity = "insufficient_evidence";
  } else if (warnings.length > 0) {
    integrity = "ready_with_warnings";
  } else {
    integrity = "ready";
  }

  return {
    integrity,
    blockingFindings,
    warnings,
    notApplicable,
    evaluatedAt: now(),
  };
}

export { CORE_EVIDENCE_KEYS, OPTIONAL_EVIDENCE_KEYS };
