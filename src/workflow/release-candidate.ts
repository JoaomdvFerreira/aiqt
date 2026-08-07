import { isValidSemver } from "../tooling/semver.js";
import type {
  ReleaseBlockingFinding,
  ReleaseCandidate,
  ReleaseEvidenceStatus,
  ReleaseMilestoneRef,
} from "../schema/release-governance.schema.js";

/**
 * M40-WU01 (build spec Sec 5.1, 6): pure, I/O-free candidate construction.
 * Explicit release intent is the only entry point -- there is no path from
 * milestone completion alone to a ReleaseCandidate (build spec Sec 5.2).
 * Callers (the service layer) resolve Git/state facts first and pass them
 * in here already-resolved; this module never touches the filesystem or a
 * process.
 */

export interface ReleaseIntentMilestoneInput {
  milestoneId: string;
  title: string | null;
  status: string | null;
  tag: string | null;
  /** Commit the declared tag resolves to via Git, or null if unresolvable/undeclared. */
  tagCommit: string | null;
  closureCommit: string | null;
}

export interface ReleaseIntentInput {
  repositoryIdentity: string;
  packageVersion: string;
  schemaVersion: string | null;
  intendedReleaseTag: string;
  candidateCommit: string;
  baseRelease: string | null;
  milestones: ReleaseIntentMilestoneInput[];
}

export type ReleaseCandidateBuildResult =
  | { ok: true; candidate: ReleaseCandidate }
  | { ok: false; blockingFindings: ReleaseBlockingFinding[] };

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function finding(id: string, area: string, message: string, evidenceKey: string | null = null): ReleaseBlockingFinding {
  return { id, area, message, evidenceKey };
}

/** Deterministic per-milestone evidence status (build spec Sec 5.3): never upgrades undeclared/unverifiable facts to "verified". */
export function computeMilestoneEvidenceStatus(ref: ReleaseIntentMilestoneInput): ReleaseEvidenceStatus {
  if (!ref.tag) return "missing";
  if (!ref.tagCommit) return "missing";
  if (!ref.closureCommit) return "partial";
  return ref.tagCommit === ref.closureCommit ? "verified" : "partial";
}

function buildMilestoneRef(input: ReleaseIntentMilestoneInput): ReleaseMilestoneRef {
  return {
    milestoneId: input.milestoneId,
    title: input.title,
    status: input.status,
    tag: input.tag,
    tagCommit: input.tagCommit,
    closureCommit: input.closureCommit,
    evidenceStatus: computeMilestoneEvidenceStatus(input),
  };
}

/** `<tag>@<first-12-hex-chars-of-commit>` -- deterministic, human-legible, collision-resistant for realistic inputs. */
export function computeReleaseCandidateId(intendedReleaseTag: string, candidateCommit: string): string {
  return `${intendedReleaseTag}@${candidateCommit.slice(0, 12)}`;
}

/**
 * Validates explicit release intent and, only if identity is fully
 * establishable, constructs the ReleaseCandidate. Missing/invalid required
 * identity fails closed with blocking findings rather than a partially
 * populated candidate (build spec Sec 5.1: "If required identity cannot be
 * established, assessment fails closed").
 */
export function buildReleaseCandidate(input: ReleaseIntentInput, now: () => string = () => new Date().toISOString()): ReleaseCandidateBuildResult {
  const blockingFindings: ReleaseBlockingFinding[] = [];

  if (!input.repositoryIdentity.trim()) {
    blockingFindings.push(finding("RELEASE-IDENTITY-MISSING-REPOSITORY", "identity", "Repository/project identity is required to establish a release candidate."));
  }
  if (!input.packageVersion.trim() || !isValidSemver(input.packageVersion)) {
    blockingFindings.push(finding("RELEASE-IDENTITY-INVALID-PACKAGE-VERSION", "identity", `Intended package release version "${input.packageVersion}" is not a valid semantic version.`));
  }
  if (!input.intendedReleaseTag.trim()) {
    blockingFindings.push(finding("RELEASE-IDENTITY-MISSING-TAG", "identity", "An intended release tag is required to establish a release candidate."));
  }
  if (!input.candidateCommit.trim() || !COMMIT_SHA_PATTERN.test(input.candidateCommit)) {
    blockingFindings.push(finding("RELEASE-IDENTITY-INVALID-COMMIT", "identity", `Candidate commit "${input.candidateCommit}" is not an unambiguous commit reference.`));
  }
  if (input.milestones.length === 0) {
    blockingFindings.push(finding("RELEASE-CANDIDATE-NO-MILESTONES", "candidate", "A release candidate must include at least one completed milestone (build spec Sec 5.1)."));
  }
  for (const m of input.milestones) {
    if (!m.milestoneId.trim()) {
      blockingFindings.push(finding("RELEASE-CANDIDATE-INVALID-MILESTONE-ID", "candidate", "Every included milestone reference requires a non-empty milestone id."));
    }
  }

  if (blockingFindings.length > 0) {
    return { ok: false, blockingFindings };
  }

  const candidate: ReleaseCandidate = {
    candidateId: computeReleaseCandidateId(input.intendedReleaseTag, input.candidateCommit),
    identity: {
      repositoryIdentity: input.repositoryIdentity,
      packageVersion: input.packageVersion,
      schemaVersion: input.schemaVersion,
      intendedReleaseTag: input.intendedReleaseTag,
      candidateCommit: input.candidateCommit,
      baseRelease: input.baseRelease,
    },
    milestones: input.milestones.map(buildMilestoneRef),
    evidence: { items: [] },
    createdAt: now(),
  };

  return { ok: true, candidate };
}
