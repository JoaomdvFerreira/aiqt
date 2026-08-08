import type {
  ReleaseApprovalAuthority,
  ReleaseCandidate,
  ReleaseEvidenceStatus,
  ReleaseProvenance,
  ReleaseReadinessAssessment,
  ReleaseRiskAssessment,
  ReleaseRiskCategoryId,
  ReleaseRiskCategoryScore,
  ReleaseRiskStatus,
} from "../schema/release-governance.schema.js";

/**
 * M40-WU02 (build spec Sec 7): deterministic, explainable, evidence-backed
 * 0-100 release-risk scoring. Every category contribution is derived from a
 * fixed lookup table applied to already-known candidate/provenance/
 * readiness facts plus a bounded set of caller-supplied structured signals
 * (enums/booleans, never a raw number) -- there is no field anywhere in
 * this module's input that lets a caller directly set the final score.
 */

export const RELEASE_RISK_ASSESSMENT_VERSION = "release-risk-v1";

export type RiskLevel = "low" | "medium" | "high" | "unknown";
/** Confidence, not risk -- "high" is the GOOD outcome here (inverse polarity from RiskLevel). */
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
export type MaturityLevel = "proven" | "limited" | "none" | "unknown";
/** true = the aspect is present/applies (e.g. real breaking changes exist); false = declared absent; null = undeclared/unknown. */
export type DeclaredAspect = boolean | null;

export interface ReleaseRiskSignals {
  regressionExposureLevel: RiskLevel;
  blastRadiusLevel: RiskLevel;
  testConfidenceLevel: ConfidenceLevel;
  operationalComplexityLevel: RiskLevel;
  breakingChangesDeclared: DeclaredAspect;
  migrationDeclared: DeclaredAspect;
  rollbackDeclared: DeclaredAspect;
  dogfoodMaturityLevel: MaturityLevel;
  knownLimitationsDeclared: DeclaredAspect;
}

/** A neutral, maximally-conservative default: every unknown/undeclared signal, matching "missing evidence never upgrades itself". */
export const UNKNOWN_RELEASE_RISK_SIGNALS: ReleaseRiskSignals = {
  regressionExposureLevel: "unknown",
  blastRadiusLevel: "unknown",
  testConfidenceLevel: "unknown",
  operationalComplexityLevel: "unknown",
  breakingChangesDeclared: null,
  migrationDeclared: null,
  rollbackDeclared: null,
  dogfoodMaturityLevel: "unknown",
  knownLimitationsDeclared: null,
};

function scoreByLevel(level: RiskLevel, max: number): number {
  if (level === "low") return Math.round(max * 0.2);
  if (level === "medium") return Math.round(max * 0.6);
  // "high" and "unknown" are both scored at the category max -- an unknown
  // signal must never be cheaper than the worst known outcome.
  return max;
}

/** Inverse polarity from scoreByLevel: "high" confidence is the good outcome. */
function scoreByConfidence(level: ConfidenceLevel, max: number): number {
  if (level === "high") return Math.round(max * 0.2);
  if (level === "medium") return Math.round(max * 0.6);
  // "low" confidence and "unknown" are both scored at the category max.
  return max;
}

function scoreDeclaredPresent(declared: DeclaredAspect, presentPoints: number, unknownPoints: number): number {
  if (declared === false) return 0;
  if (declared === true) return presentPoints;
  return unknownPoints;
}

function scoreMaturity(level: MaturityLevel, max: number): number {
  if (level === "proven") return 0;
  if (level === "limited") return Math.round(max * 0.6);
  return max; // "none" and "unknown"
}

interface CategoryResult {
  category: ReleaseRiskCategoryId;
  score: number;
  max: number;
  rationale: string;
}

function scoreSecurity(status: ReleaseEvidenceStatus): CategoryResult {
  const max = 20;
  const byStatus: Record<ReleaseEvidenceStatus, number> = {
    verified: 0,
    waived: 6,
    partial: 12,
    reconstructed: 16,
    missing: 20,
  };
  const score = byStatus[status];
  return { category: "security_supply_chain", score, max, rationale: `Security/supply-chain evidence status is "${status}".` };
}

function scoreRegression(level: RiskLevel): CategoryResult {
  const max = 15;
  return { category: "regression_exposure", score: scoreByLevel(level, max), max, rationale: `Regression exposure signal is "${level}".` };
}

function scoreBlastRadius(level: RiskLevel): CategoryResult {
  const max = 15;
  return { category: "architectural_blast_radius", score: scoreByLevel(level, max), max, rationale: `Architectural/change blast-radius signal is "${level}".` };
}

function scoreTestConfidence(level: ConfidenceLevel, ciStatus: ReleaseEvidenceStatus): CategoryResult {
  const max = 15;
  const base = scoreByConfidence(level, max);
  // CI evidence that is not "verified" can never make test confidence look better than the base signal already implies.
  const score = ciStatus === "verified" ? base : Math.max(base, Math.round(max * 0.8));
  return { category: "test_confidence", score, max, rationale: `Test confidence signal is "${level}"; CI evidence status is "${ciStatus}".` };
}

function scoreOperationalComplexity(level: RiskLevel): CategoryResult {
  const max = 10;
  return { category: "operational_complexity", score: scoreByLevel(level, max), max, rationale: `Operational complexity signal is "${level}".` };
}

function scoreCompatibilityMigration(breakingChangesDeclared: DeclaredAspect, migrationDeclared: DeclaredAspect): CategoryResult {
  const max = 10;
  const breakingPoints = scoreDeclaredPresent(breakingChangesDeclared, 5, 10);
  const migrationPoints = scoreDeclaredPresent(migrationDeclared, 0, 5);
  const score = Math.min(max, breakingPoints + migrationPoints);
  return {
    category: "compatibility_migration",
    score,
    max,
    rationale: `Breaking changes declared: ${String(breakingChangesDeclared)}; migration guidance declared: ${String(migrationDeclared)}.`,
  };
}

/** true = a rollback/recovery procedure is declared present (mitigation exists, low risk); false = explicitly declared absent; null = undeclared/unknown. */
function scoreRollback(rollbackDeclared: DeclaredAspect): CategoryResult {
  const max = 5;
  const score = rollbackDeclared === true ? 0 : rollbackDeclared === false ? 4 : max;
  return { category: "rollback_recovery", score, max, rationale: `Rollback/recovery procedure declared: ${String(rollbackDeclared)}.` };
}

function scoreDogfoodMaturity(level: MaturityLevel): CategoryResult {
  const max = 5;
  return { category: "pilot_dogfood_maturity", score: scoreMaturity(level, max), max, rationale: `Pilot/dogfood maturity signal is "${level}".` };
}

/** true = known limitations are documented (low residual risk); false = explicitly declared none; null = undeclared/unknown. */
function scoreKnownLimitations(knownLimitationsDeclared: DeclaredAspect): CategoryResult {
  const max = 5;
  const score = knownLimitationsDeclared === true ? 0 : knownLimitationsDeclared === false ? 1 : max;
  return { category: "known_limitations", score, max, rationale: `Known limitations declared: ${String(knownLimitationsDeclared)}.` };
}

/** Exact four-band boundaries (build spec Sec 5.5): 0-24 green, 25-49 yellow, 50-74 orange, 75-100 red. */
export function computeReleaseRiskStatus(score: number): ReleaseRiskStatus {
  if (score <= 24) return "green";
  if (score <= 49) return "yellow";
  if (score <= 74) return "orange";
  return "red";
}

/** Exact approval-authority boundaries (build spec Sec 5.5): <50 agent, 50-74 human, >=75 human+waiver. */
export function computeReleaseApprovalAuthority(score: number): ReleaseApprovalAuthority {
  if (score < 50) return "agent_approval_permitted";
  if (score < 75) return "human_approval_required";
  return "human_waiver_required";
}

function buildMitigations(categories: ReleaseRiskCategoryScore[]): string[] {
  const mitigations: string[] = [];
  for (const c of categories) {
    if (c.score === 0) continue;
    switch (c.category) {
      case "security_supply_chain":
        mitigations.push("Obtain verified security/supply-chain evidence before publication.");
        break;
      case "regression_exposure":
        mitigations.push("Run targeted regression validation covering the changed surface.");
        break;
      case "architectural_blast_radius":
        mitigations.push("Confirm the architectural blast radius with an impact review of downstream consumers.");
        break;
      case "test_confidence":
        mitigations.push("Increase test confidence with authoritative, currently-green CI evidence.");
        break;
      case "operational_complexity":
        mitigations.push("Document the operational rollout/runbook steps for this release.");
        break;
      case "compatibility_migration":
        mitigations.push("Declare breaking changes and migration guidance explicitly.");
        break;
      case "rollback_recovery":
        mitigations.push("Declare a concrete rollback/recovery procedure.");
        break;
      case "pilot_dogfood_maturity":
        mitigations.push("Increase pilot/dogfood coverage before wider release.");
        break;
      case "known_limitations":
        mitigations.push("Declare known limitations explicitly, even if the list is empty.");
        break;
    }
  }
  return mitigations;
}

export function assessReleaseRisk(
  candidate: ReleaseCandidate,
  provenance: ReleaseProvenance,
  readiness: ReleaseReadinessAssessment,
  signals: ReleaseRiskSignals,
): ReleaseRiskAssessment {
  const categories: ReleaseRiskCategoryScore[] = [
    scoreSecurity(provenance.securityEvidenceStatus),
    scoreRegression(signals.regressionExposureLevel),
    scoreBlastRadius(signals.blastRadiusLevel),
    scoreTestConfidence(signals.testConfidenceLevel, provenance.ciStatus),
    scoreOperationalComplexity(signals.operationalComplexityLevel),
    scoreCompatibilityMigration(signals.breakingChangesDeclared, signals.migrationDeclared),
    scoreRollback(signals.rollbackDeclared),
    scoreDogfoodMaturity(signals.dogfoodMaturityLevel),
    scoreKnownLimitations(signals.knownLimitationsDeclared),
  ];

  const totalScore = Math.min(100, categories.reduce((sum, c) => sum + c.score, 0));
  const status = computeReleaseRiskStatus(totalScore);
  const requiredApprovalAuthority = computeReleaseApprovalAuthority(totalScore);
  const waiverRequired = requiredApprovalAuthority === "human_waiver_required";

  const nonZero = categories.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  const majorContributors = nonZero.filter((c) => c.score / c.max >= 0.5).map((c) => c.category);
  const residualRisks = nonZero.filter((c) => c.score / c.max < 0.5).map((c) => `${c.category}: ${c.rationale}`);

  const evidenceGaps: string[] = [...readiness.warnings.map((w) => w.message)];
  if (candidate.identity.schemaVersion === null) {
    evidenceGaps.push("No canonical schema version declared for this candidate (may be not_applicable).");
  }

  const blockers = readiness.blockingFindings.map((f) => f.message);

  const operationalRecommendation =
    status === "green"
      ? "Low release risk. Agent/automated approval remains permitted when all other gates pass."
      : status === "yellow"
        ? "Controlled release risk. Agent/automated approval remains permitted, but review the listed mitigations."
        : status === "orange"
          ? "Elevated release risk. Human approval is required before publication."
          : "High release risk. Human approval and an explicit waiver are required before publication.";

  return {
    totalScore,
    status,
    categories,
    majorContributors,
    mitigations: buildMitigations(categories),
    residualRisks,
    blockers,
    operationalRecommendation,
    requiredApprovalAuthority,
    waiverRequired,
    assessmentVersion: RELEASE_RISK_ASSESSMENT_VERSION,
    evidenceGaps,
  };
}
