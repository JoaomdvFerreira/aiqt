import { formatSemver } from "../tooling/semver.js";
import {
  discoverSemverReleaseTags,
  discoverMilestoneReferences,
  readPackageVersionAtCommit,
  readSchemaVersionAtCommit,
  readTargetCommitTime,
  resolveRefSafely,
  selectBaseRelease,
} from "../workflow/historical-evidence.js";
import {
  buildReconstructionAssessment,
  mapToReleaseIntentRequest,
  renderRetrospectiveReleaseNotes,
} from "../workflow/reconstruction-engine.js";
import { assessReleaseDecision } from "./release-governance-service.js";
import type { ReleaseBlockingFinding, ReleaseDecision } from "../schema/release-governance.schema.js";
import type {
  HistoricalEvidenceConflict,
  HistoricalEvidenceItem,
  HistoricalReleaseTarget,
  ReconstructionAssessment,
} from "../schema/historical-reconstruction.schema.js";

/**
 * M44-WU02: the one orchestration point that reads live, bounded Git/file
 * facts and assembles them into the M44-WU01 evidence contract. Mirrors
 * M40's release-governance-service.ts split: pure evidence-collection
 * functions live in src/workflow/historical-evidence.ts, this service is
 * the only caller that sequences them against a real `cwd`. Read-only --
 * no Git mutation, no network, no GitHub access (that boundary is WU44-04).
 */

// ---------------------------------------------------------------------------
// `release history` -- lightweight, read-only inventory (build spec Sec 4.1).
// ---------------------------------------------------------------------------

export interface HistoricalReleaseTargetSummary {
  tag: string;
  commit: string;
  packageVersionAtCommit: string | null;
  /** null when packageVersionAtCommit could not be read (unknown, not "matches"). */
  versionMatchesTag: boolean | null;
}

/** Every discovered SemVer tag, each resolved to its commit and cross-checked against package.json at that commit -- deterministic, repository-local only. */
export function listHistoricalReleaseTargets(cwd: string): HistoricalReleaseTargetSummary[] {
  return discoverSemverReleaseTags(cwd).map((t) => {
    const packageVersionAtCommit = readPackageVersionAtCommit(cwd, t.commit);
    const normalizedTagVersion = formatSemver(t.version);
    return {
      tag: t.tag,
      commit: t.commit,
      packageVersionAtCommit,
      versionMatchesTag: packageVersionAtCommit === null ? null : packageVersionAtCommit === normalizedTagVersion,
    };
  });
}

// ---------------------------------------------------------------------------
// `release reconstruct <tag>` evidence ledger (build spec Sec 6, 7).
// ---------------------------------------------------------------------------

export type BuildHistoricalTargetOutcome =
  | { ok: true; target: HistoricalReleaseTarget; evidence: HistoricalEvidenceItem[]; conflicts: HistoricalEvidenceConflict[] }
  | { ok: false; reason: "tag_not_found" };

/**
 * Assembles the full bounded evidence ledger for one explicit requested tag
 * (build spec Sec 6.2, 7). Every field is either directly resolved Git/file
 * evidence or an explicit `missing`/ambiguous marker -- nothing here is
 * inferred from title/filename similarity (build spec Sec 6.2).
 */
export function buildHistoricalReleaseTarget(
  cwd: string,
  repositoryIdentity: string,
  requestedTag: string,
): BuildHistoricalTargetOutcome {
  const resolvedCommit = resolveRefSafely(cwd, `refs/tags/${requestedTag}^{commit}`);
  if (!resolvedCommit) return { ok: false, reason: "tag_not_found" };

  const allTags = discoverSemverReleaseTags(cwd);
  const baseCandidates = allTags.filter((t) => t.tag !== requestedTag);
  const base = selectBaseRelease(cwd, resolvedCommit, baseCandidates);

  const packageVersionAtCommit = readPackageVersionAtCommit(cwd, resolvedCommit);
  const schemaVersionAtCommit = readSchemaVersionAtCommit(cwd, resolvedCommit);
  const targetCommitTime = readTargetCommitTime(cwd, resolvedCommit);
  const milestones = discoverMilestoneReferences(cwd, resolvedCommit);

  const evidence: HistoricalEvidenceItem[] = [];
  const conflicts: HistoricalEvidenceConflict[] = [];

  evidence.push({
    key: "target_tag_commit",
    sourceKind: "git_tag",
    status: "verified",
    description: `Tag "${requestedTag}" resolves to an exact local commit.`,
    locator: `refs/tags/${requestedTag}`,
    digest: null,
  });

  evidence.push({
    key: "package_version_at_commit",
    sourceKind: "package_manifest_at_commit",
    status: packageVersionAtCommit !== null ? "reconstructed" : "missing",
    description:
      packageVersionAtCommit !== null
        ? `package.json version "${packageVersionAtCommit}" recovered at the tagged commit.`
        : "package.json could not be read at the tagged commit.",
    locator: "package.json",
    digest: null,
  });

  evidence.push({
    key: "schema_version_at_commit",
    sourceKind: "schema_version_at_commit",
    status: schemaVersionAtCommit !== null ? "reconstructed" : "missing",
    description:
      schemaVersionAtCommit !== null
        ? `AIQT_SCHEMA_VERSION "${schemaVersionAtCommit}" recovered at the tagged commit.`
        : "No schema-version file found at the tagged commit (not applicable to non-AIQT-managed projects).",
    locator: "src/core/constants/schema-version.ts",
    digest: null,
  });

  evidence.push({
    key: "base_release",
    sourceKind: "git_ancestry",
    status: base.ambiguous ? "missing" : "verified",
    description: base.ambiguous
      ? "Base release is ambiguous: multiple divergent candidate tags are equally plausible."
      : base.baseRelease !== null
        ? `Nearest ancestor release tag "${base.baseRelease}" selected by Git ancestry.`
        : "No prior release tag reachable in ancestry; target has no base release.",
    locator: base.baseRelease,
    digest: null,
  });

  for (const m of milestones) {
    evidence.push({
      key: `milestone:${m.milestoneId}`,
      sourceKind: m.closureReportPath !== null ? "milestone_closure_report" : "milestone_tag",
      status: m.evidenceStatus,
      description:
        m.closureReportPath !== null
          ? `Milestone "${m.milestoneId}" tag and closure report both evidenced.`
          : `Milestone "${m.milestoneId}" tag evidenced, but no closure report found at either known path.`,
      locator: m.closureReportPath ?? m.tag,
      digest: null,
    });
  }

  if (packageVersionAtCommit !== null) {
    const normalizedTag = requestedTag.replace(/^v(?=\d)/, "");
    if (packageVersionAtCommit !== normalizedTag) {
      conflicts.push({
        id: "HIST-TAG-PACKAGE-VERSION-MISMATCH",
        message: `Tag "${requestedTag}" implies version "${normalizedTag}", but package.json at that commit records "${packageVersionAtCommit}".`,
        evidenceKeys: ["target_tag_commit", "package_version_at_commit"],
      });
    }
  }

  const target: HistoricalReleaseTarget = {
    repositoryIdentity,
    requestedTag,
    resolvedCommit,
    packageVersionAtCommit,
    schemaVersionAtCommit,
    baseRelease: base.baseRelease,
    baseReleaseAmbiguous: base.ambiguous,
    milestones,
    targetCommitTime,
  };

  return { ok: true, target, evidence, conflicts };
}

// ---------------------------------------------------------------------------
// `release reconstruct <tag>` full assessment (build spec Sec 9, WU44-03) --
// maps a sufficiently evidenced target into the existing M40 candidate/
// provenance/readiness/risk/approval/notes flow. Never a second decision
// owner: `assessReleaseDecision` here is the exact same M40-WU01 function
// `aiqt release assess`/`validate`/`notes` call.
// ---------------------------------------------------------------------------

export interface ReconstructedHistoricalRelease {
  assessment: ReconstructionAssessment;
  /** Populated only when the target had a package version, at least one evidenced milestone, and passed M40's own candidate-identity checks. */
  decision: ReleaseDecision | null;
  /** M40's own blocking findings when a sufficiently evidenced target still fails M40's candidate-identity requirements (e.g. zero evidenced milestones) -- never silently dropped. */
  m40BlockingFindings: ReleaseBlockingFinding[];
  retrospectiveNotes: string | null;
}

export type ReconstructHistoricalReleaseOutcome =
  | { ok: true; result: ReconstructedHistoricalRelease }
  | { ok: false; reason: "tag_not_found" };

export function reconstructHistoricalRelease(
  cwd: string,
  repositoryIdentity: string,
  requestedTag: string,
): ReconstructHistoricalReleaseOutcome {
  const built = buildHistoricalReleaseTarget(cwd, repositoryIdentity, requestedTag);
  if (!built.ok) return { ok: false, reason: built.reason };

  const { target, evidence, conflicts } = built;
  const assessment = buildReconstructionAssessment(target, evidence, conflicts);

  let decision: ReleaseDecision | null = null;
  let m40BlockingFindings: ReleaseBlockingFinding[] = [];
  let retrospectiveNotes: string | null = null;

  if (assessment.status !== "insufficient_evidence") {
    const request = mapToReleaseIntentRequest(cwd, target);
    const outcome = assessReleaseDecision(request);
    if (outcome.ok) {
      decision = outcome.decision;
      if (decision.risk !== null && decision.approval !== null) {
        retrospectiveNotes = renderRetrospectiveReleaseNotes(assessment, {
          ...decision,
          risk: decision.risk,
          approval: decision.approval,
        });
      }
    } else {
      m40BlockingFindings = outcome.blockingFindings;
    }
  }

  return { ok: true, result: { assessment, decision, m40BlockingFindings, retrospectiveNotes } };
}
