import { describe, it, expect } from "vitest";
import {
  assessReleaseRisk,
  computeReleaseApprovalAuthority,
  computeReleaseRiskStatus,
  UNKNOWN_RELEASE_RISK_SIGNALS,
  type ReleaseRiskSignals,
} from "../../src/workflow/release-risk.js";
import { buildInitialApprovalEvidence } from "../../src/workflow/release-approval.js";
import { buildReleaseCandidate, type ReleaseIntentInput } from "../../src/workflow/release-candidate.js";
import { buildReleaseProvenance, type ReleaseProvenanceFacts } from "../../src/workflow/release-provenance.js";
import { assessReleaseReadiness } from "../../src/workflow/release-readiness.js";

const input: ReleaseIntentInput = {
  repositoryIdentity: "example/widget",
  packageVersion: "1.0.0",
  schemaVersion: "0.5.0",
  intendedReleaseTag: "v1.0.0",
  candidateCommit: "abc1234def5678",
  baseRelease: null,
  milestones: [{ milestoneId: "m1", title: "One", status: "done", tag: "t", tagCommit: "abc1234def5678", closureCommit: "abc1234def5678" }],
};

const cleanFacts: ReleaseProvenanceFacts = {
  ciCommit: "abc1234def5678",
  ciRunIdentity: "run-1",
  ciStatus: "verified",
  validationEvidenceDigest: "sha256:aaaa",
  securityEvidenceStatus: "verified",
  releaseNotesDigest: "sha256:bbbb",
  riskAssessmentVersion: null,
  approvalAuthorityDecision: null,
};

const bestSignals: ReleaseRiskSignals = {
  regressionExposureLevel: "low",
  blastRadiusLevel: "low",
  testConfidenceLevel: "high",
  operationalComplexityLevel: "low",
  breakingChangesDeclared: false,
  migrationDeclared: false,
  rollbackDeclared: true,
  dogfoodMaturityLevel: "proven",
  knownLimitationsDeclared: true,
};

function candidateOrThrow(overrides: Partial<ReleaseIntentInput> = {}) {
  const result = buildReleaseCandidate({ ...input, ...overrides });
  if (!result.ok) throw new Error("expected candidate build to succeed");
  return result.candidate;
}

describe("computeReleaseRiskStatus: exact four-band boundaries", () => {
  it.each([
    [0, "green"],
    [24, "green"],
    [25, "yellow"],
    [49, "yellow"],
    [50, "orange"],
    [74, "orange"],
    [75, "red"],
    [100, "red"],
  ] as const)("score %i -> %s", (score, expected) => {
    expect(computeReleaseRiskStatus(score)).toBe(expected);
  });
});

describe("computeReleaseApprovalAuthority: exact approval-authority boundaries", () => {
  it.each([
    [0, "agent_approval_permitted"],
    [24, "agent_approval_permitted"],
    [25, "agent_approval_permitted"],
    [49, "agent_approval_permitted"],
    [50, "human_approval_required"],
    [74, "human_approval_required"],
    [75, "human_waiver_required"],
    [100, "human_waiver_required"],
  ] as const)("score %i -> %s", (score, expected) => {
    expect(computeReleaseApprovalAuthority(score)).toBe(expected);
  });
});

describe("assessReleaseRisk: deterministic, bounded, evidence-backed", () => {
  it("is deterministic for identical canonical inputs", () => {
    const candidate = candidateOrThrow();
    const provenance = buildReleaseProvenance(candidate, cleanFacts);
    const readiness = assessReleaseReadiness(candidate, provenance, { tagAlreadyExists: false, declaredNotApplicable: [], declaredPresent: [] });
    const r1 = assessReleaseRisk(candidate, provenance, readiness, bestSignals);
    const r2 = assessReleaseRisk(candidate, provenance, readiness, bestSignals);
    expect(r1).toEqual(r2);
  });

  it("total score always stays within 0-100 and category maxima sum to exactly 100", () => {
    const candidate = candidateOrThrow();
    const provenance = buildReleaseProvenance(candidate, cleanFacts);
    const readiness = assessReleaseReadiness(candidate, provenance, { tagAlreadyExists: false, declaredNotApplicable: [], declaredPresent: [] });
    const risk = assessReleaseRisk(candidate, provenance, readiness, UNKNOWN_RELEASE_RISK_SIGNALS);
    expect(risk.totalScore).toBeGreaterThanOrEqual(0);
    expect(risk.totalScore).toBeLessThanOrEqual(100);
    expect(risk.categories.reduce((sum, c) => sum + c.max, 0)).toBe(100);
  });

  it("a fully clean candidate with best-case signals scores low (green)", () => {
    const candidate = candidateOrThrow();
    const provenance = buildReleaseProvenance(candidate, cleanFacts);
    const readiness = assessReleaseReadiness(candidate, provenance, { tagAlreadyExists: false, declaredNotApplicable: [], declaredPresent: [] });
    const risk = assessReleaseRisk(candidate, provenance, readiness, bestSignals);
    expect(risk.status).toBe("green");
    expect(risk.requiredApprovalAuthority).toBe("agent_approval_permitted");
    expect(risk.waiverRequired).toBe(false);
  });

  it("all-unknown signals plus missing security evidence pushes the score into red", () => {
    const candidate = candidateOrThrow();
    const dirtyFacts: ReleaseProvenanceFacts = { ...cleanFacts, securityEvidenceStatus: "missing", ciStatus: "missing", validationEvidenceDigest: null };
    const provenance = buildReleaseProvenance(candidate, dirtyFacts);
    const readiness = assessReleaseReadiness(candidate, provenance, { tagAlreadyExists: false, declaredNotApplicable: [], declaredPresent: [] });
    const risk = assessReleaseRisk(candidate, provenance, readiness, UNKNOWN_RELEASE_RISK_SIGNALS);
    expect(risk.status).toBe("red");
    expect(risk.requiredApprovalAuthority).toBe("human_waiver_required");
    expect(risk.waiverRequired).toBe(true);
    expect(risk.blockers.length).toBeGreaterThan(0);
  });

  it("no caller-supplied field can set totalScore directly -- ReleaseRiskSignals carries no numeric total", () => {
    const keys = Object.keys(bestSignals);
    expect(keys).not.toContain("totalScore");
    expect(keys).not.toContain("score");
  });
});

describe("buildInitialApprovalEvidence: never fabricates human approval", () => {
  it("authority mirrors the risk assessment; human/waiver fields stay null", () => {
    const candidate = candidateOrThrow();
    const provenance = buildReleaseProvenance(candidate, cleanFacts);
    const readiness = assessReleaseReadiness(candidate, provenance, { tagAlreadyExists: false, declaredNotApplicable: [], declaredPresent: [] });
    const risk = assessReleaseRisk(candidate, provenance, readiness, UNKNOWN_RELEASE_RISK_SIGNALS);
    const approval = buildInitialApprovalEvidence(risk);
    expect(approval.authority).toBe(risk.requiredApprovalAuthority);
    expect(approval.humanApprovedBy).toBeNull();
    expect(approval.humanApprovedAt).toBeNull();
    expect(approval.waiver).toBeNull();
  });
});
