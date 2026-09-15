import { meetsTrustLevel } from "../schema/evidence.schema.js";
import type { EvidenceGatePolicy, EvidenceGateRule } from "../schema/evidence-gate-policy.schema.js";
import type {
  EvidenceGateSimulation,
  EvidenceGateRuleResult,
  SimulationTarget,
  OverallResult,
  RuleResultOutcome,
  ReasonCode,
} from "../schema/evidence-gate-simulation.schema.js";
import { EVIDENCE_GATE_SIMULATION_PROTOCOL_VERSION } from "../schema/evidence-gate-simulation.schema.js";
import type { NormalizedEvidenceSnapshotEntry } from "../schema/evidence-gate-simulation.schema.js";
import { computeEvidenceSnapshotDigest, computeSimulationDigest } from "./evidence-gate-digest.js";

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * M28 §5.6: `0 <= ageSeconds <= maxAgeSeconds`. A future-dated or invalid
 * freshness timestamp never satisfies freshness.
 */
function satisfiesFreshness(freshnessTimestamp: string | null, asOf: string, maxAgeSeconds: number): boolean {
  if (freshnessTimestamp === null) return false;
  const tsMs = Date.parse(freshnessTimestamp);
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(tsMs) || Number.isNaN(asOfMs)) return false;
  const ageSeconds = (asOfMs - tsMs) / 1000;
  return ageSeconds >= 0 && ageSeconds <= maxAgeSeconds;
}

/**
 * M28 §5.5: canonical scope matching, using only explicit scope-refs
 * already present on the snapshot entry -- no heuristic association.
 */
function isInScope(entry: NormalizedEvidenceSnapshotEntry, target: SimulationTarget, scopeMatch: "exact_target" | "target_or_project"): boolean {
  const exactRef = `${target.type}:${target.id}`;
  if (entry.scopeRefs.includes(exactRef)) return true;
  if (scopeMatch !== "target_or_project") return false;

  const projectRef = `project:${target.relatedProjectId}`;
  if (entry.scopeRefs.includes(projectRef)) return true;

  if (target.type === "checkpoint" && target.relatedWorkUnitId) {
    if (entry.scopeRefs.includes(`work_unit:${target.relatedWorkUnitId}`)) return true;
  }
  return false;
}

function boundedSummary(text: string): string {
  return text.length > 2000 ? text.slice(0, 2000) : text;
}

/**
 * M28 §3.2/§5.3: evaluates one rule against the full evidence snapshot.
 * Each snapshot entry (evidence record) counts at most once toward this
 * rule, in exactly one of: matched, or rejected for exactly one reason
 * (checked in the specification's own implied precedence: validity,
 * then artifact-kind, then trust, then scope, then freshness).
 */
export function evaluateRule(rule: EvidenceGateRule, target: SimulationTarget, entries: readonly NormalizedEvidenceSnapshotEntry[], asOf: string): EvidenceGateRuleResult {
  const requiredCount = rule.requirement.minimumCount;

  if (!rule.appliesTo.includes(target.type)) {
    return {
      ruleId: rule.ruleId,
      result: "not_applicable",
      requiredCount,
      matchedCount: 0,
      matchedEvidenceRefs: [],
      rejectedCandidateCounts: { wrongArtifactKind: 0, insufficientTrust: 0, wrongScope: 0, stale: 0, unsuccessfulOutcome: 0, invalidReference: 0 },
      reasonCode: "target_not_applicable",
      summary: boundedSummary(`Rule "${rule.ruleId}" does not apply to target type "${target.type}".`),
    };
  }

  const rejected = { wrongArtifactKind: 0, insufficientTrust: 0, wrongScope: 0, stale: 0, unsuccessfulOutcome: 0, invalidReference: 0 };
  const matched: string[] = [];

  for (const entry of entries) {
    if (entry.referenceValidity === "invalid") {
      rejected.invalidReference += 1;
      continue;
    }
    const selectedKinds: readonly string[] = rule.evidenceSelector.artifactKinds;
    const hasSelectedKind = entry.artifactKinds.some((k) => selectedKinds.includes(k));
    if (!hasSelectedKind) {
      rejected.wrongArtifactKind += 1;
      continue;
    }
    if (!meetsTrustLevel(entry.trust, rule.evidenceSelector.minimumTrust)) {
      rejected.insufficientTrust += 1;
      continue;
    }
    if (!isInScope(entry, target, rule.evidenceSelector.scopeMatch)) {
      rejected.wrongScope += 1;
      continue;
    }
    if (rule.evidenceSelector.maxAgeSeconds !== undefined && !satisfiesFreshness(entry.freshnessTimestamp, asOf, rule.evidenceSelector.maxAgeSeconds)) {
      rejected.stale += 1;
      continue;
    }
    if (rule.evidenceSelector.outcomeRequirement === "validation_passed" && entry.validationResult !== "passed") {
      rejected.unsuccessfulOutcome += 1;
      continue;
    }
    matched.push(entry.evidenceId);
  }

  const matchedEvidenceRefs = Array.from(new Set(matched)).sort();
  const matchedCount = matchedEvidenceRefs.length;

  let result: RuleResultOutcome;
  let reasonCode: ReasonCode;
  if (matchedCount >= requiredCount) {
    result = "pass";
    reasonCode = "sufficient_evidence";
  } else if (rule.missingDisposition === "fail") {
    result = "fail";
    reasonCode = "insufficient_evidence";
  } else {
    result = "indeterminate";
    reasonCode = "insufficient_evidence_indeterminate";
  }

  return {
    ruleId: rule.ruleId,
    result,
    requiredCount,
    matchedCount,
    matchedEvidenceRefs,
    rejectedCandidateCounts: rejected,
    reasonCode,
    summary: boundedSummary(`Rule "${rule.ruleId}": ${matchedCount}/${requiredCount} matching evidence record(s) -> ${result}.`),
  };
}

/** M28 §5.3: overall aggregation across every applicable rule result. */
export function aggregateOverallResult(ruleResults: readonly EvidenceGateRuleResult[]): OverallResult {
  const applicable = ruleResults.filter((r) => r.result !== "not_applicable");
  if (applicable.length === 0) return "indeterminate";
  if (applicable.some((r) => r.result === "fail")) return "fail";
  if (applicable.some((r) => r.result === "indeterminate")) return "indeterminate";
  return "pass";
}

export interface SimulateParams {
  policy: EvidenceGatePolicy;
  target: SimulationTarget;
  entries: readonly NormalizedEvidenceSnapshotEntry[];
  asOf: string;
  generatedAt: string;
}

/**
 * M28 §5: the sole simulation entry point. Pure -- never performs I/O,
 * never mutates canonical state, never appends a runlog event.
 */
export function simulate(params: SimulateParams): EvidenceGateSimulation {
  if (!isValidIsoTimestamp(params.asOf)) {
    throw new Error(`Invalid asOf timestamp: ${params.asOf}`);
  }

  const ruleResults = params.policy.rules.map((rule) => evaluateRule(rule, params.target, params.entries, params.asOf));
  const overallResult = aggregateOverallResult(ruleResults);
  const evidenceSnapshotDigest = computeEvidenceSnapshotDigest(params.target, params.entries);
  const simulationDigest = computeSimulationDigest({
    policyDigest: params.policy.policyDigest,
    target: params.target,
    asOf: params.asOf,
    evidenceSnapshotDigest,
    ruleResults,
  });

  return {
    protocolVersion: EVIDENCE_GATE_SIMULATION_PROTOCOL_VERSION,
    policy: { policyId: params.policy.policyId, version: params.policy.version, digest: params.policy.policyDigest },
    target: params.target,
    asOf: params.asOf,
    overallResult,
    ruleResults,
    evidenceSnapshotDigest,
    simulationDigest,
    generatedAt: params.generatedAt,
  };
}
