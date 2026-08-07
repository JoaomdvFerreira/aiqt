import type { ReleaseApprovalEvidence, ReleaseDecision, ReleaseRiskAssessment, ReleaseRiskStatus } from "../schema/release-governance.schema.js";

/**
 * M40-WU03 (build spec Sec 9): deterministic human-readable release notes
 * generated from the exact same ReleaseDecision snapshot the JSON output
 * carries -- risk/readiness/approval are rendered at the top, never buried.
 * Pure formatting only: no filesystem, no network.
 */

export interface ReadyReleaseDecision extends ReleaseDecision {
  risk: ReleaseRiskAssessment;
  approval: ReleaseApprovalEvidence;
}

const STATUS_BADGE: Record<ReleaseRiskStatus, string> = {
  green: "🟢",
  yellow: "🟡",
  orange: "🟠",
  red: "🔴",
};

const APPROVAL_LABEL: Record<ReleaseApprovalEvidence["authority"], string> = {
  agent_approval_permitted: "Agent permitted",
  human_approval_required: "Human required",
  human_waiver_required: "Human + waiver required",
};

const INTEGRITY_LABEL: Record<ReleaseDecision["readiness"]["integrity"], string> = {
  ready: "READY",
  ready_with_warnings: "READY WITH WARNINGS",
  blocked: "BLOCKED",
  insufficient_evidence: "INSUFFICIENT EVIDENCE",
};

function checkmark(value: boolean): string {
  return value ? "✅" : "❌";
}

function bulletOrNone(items: readonly string[]): string {
  if (items.length === 0) return "- None declared.";
  return items.map((i) => `- ${i}`).join("\n");
}

export function renderReleaseNotesMarkdown(decision: ReadyReleaseDecision): string {
  const { candidate, provenance, readiness, risk, approval } = decision;
  const badge = STATUS_BADGE[risk.status];
  const milestoneList = candidate.milestones.map((m) => `${m.milestoneId}${m.title ? ` (${m.title})` : ""}`).join(", ");
  const breakingChangesDeclared = readiness.notApplicable.includes("breakingChanges") ? "Not applicable" : "See Breaking Changes section";

  const lines: string[] = [
    `# AIQT v${candidate.identity.packageVersion} — ${candidate.identity.intendedReleaseTag}`,
    "",
    `> ${badge} **RISK: ${risk.totalScore}/100 — ${risk.status.toUpperCase()}**`,
    `> **Candidate integrity:** ${INTEGRITY_LABEL[readiness.integrity]}`,
    `> **Approval authority:** ${APPROVAL_LABEL[approval.authority]}${risk.waiverRequired ? " (waiver required)" : ""}`,
    "",
    "## At a Glance",
    "| Included milestones | Candidate commit | CI | Breaking changes |",
    "|---|---|---|---|",
    `| ${milestoneList} | ${candidate.identity.candidateCommit} | ${checkmark(provenance.ciStatus === "verified")} | ${breakingChangesDeclared} |`,
    "",
    "## Summary",
    `Release candidate ${candidate.candidateId} for ${candidate.identity.repositoryIdentity}, aggregating ${candidate.milestones.length} milestone(s).`,
    "",
    "## Delivered Capabilities",
    "Not captured by `aiqt release notes` -- supply from milestone documentation.",
    "",
    "## Included Milestones",
    ...candidate.milestones.map(
      (m) => `- **${m.milestoneId}**${m.title ? ` -- ${m.title}` : ""} (status: ${m.status ?? "unknown"}, evidence: ${m.evidenceStatus})`,
    ),
    "",
    "## Important Fixes",
    "Not captured by `aiqt release notes` -- supply from milestone documentation.",
    "",
    "## Validation Evidence",
    `- CI: ${provenance.ciStatus}${provenance.ciRunIdentity ? ` (run ${provenance.ciRunIdentity})` : ""}`,
    `- Validation evidence digest: ${provenance.validationEvidenceDigest ?? "none"}`,
    "",
    "## Risk / Potential Risks",
    "### Main Risk Contributors",
    bulletOrNone(risk.majorContributors),
    "",
    "### Mitigations",
    bulletOrNone(risk.mitigations),
    "",
    "### Residual Risks",
    bulletOrNone(risk.residualRisks),
    "",
    "### Operational Recommendation",
    risk.operationalRecommendation,
    "",
    "## Security and Supply Chain",
    `Status: ${provenance.securityEvidenceStatus}`,
    "",
    "## Breaking Changes",
    readiness.notApplicable.includes("breakingChanges") ? "Not applicable to this candidate." : "See operator-declared evidence.",
    "",
    "## Upgrade / Migration Notes",
    readiness.notApplicable.includes("migration") ? "Not applicable to this candidate." : "See operator-declared evidence.",
    "",
    "## Known Limitations",
    readiness.notApplicable.includes("knownLimitations") ? "None declared; not applicable to this candidate." : "See operator-declared evidence.",
    "",
    "## Rollback and Recovery",
    readiness.notApplicable.includes("rollback") ? "Not applicable to this candidate." : "See operator-declared evidence.",
    "",
    "## Provenance",
    `- Candidate commit: ${provenance.candidateCommit}`,
    `- CI commit: ${provenance.ciCommit ?? "none"}`,
    `- Base release: ${provenance.baseRelease ?? "none"}`,
    `- Included milestone ids: ${provenance.includedMilestoneIds.join(", ") || "none"}`,
    `- Digest: ${provenance.digest}`,
    `- Risk assessment version: ${risk.assessmentVersion}`,
  ];

  return lines.join("\n") + "\n";
}
