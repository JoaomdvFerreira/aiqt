import type { RemediationRiskBand } from "../schema/defect.schema.js";

/**
 * M42-WU04 §3.4/§8: remediation IMPLEMENTATION risk -- deliberately
 * separate from defect severity/confidence (see defect-triage.ts, which
 * never reads this module and vice versa) and from release risk
 * (release-risk.ts, a distinct domain with its own inputs). Applies the
 * same repository-wide four-band boundaries (0-24 green, 25-49 yellow,
 * 50-74 orange, 75-100 red; human boundary at 50 -- docs/governance/
 * versioning.md) to a remediation-specific scope/target input, not a
 * second implementation of release-risk.ts's own scoring.
 */

const FOUNDATIONAL_PATH_PATTERNS: readonly RegExp[] = [
  /^src\/schema\//,
  /^src\/state\//,
  /^src\/core\/filesystem\//,
  /^src\/core\/output\//,
  /^src\/workflow\/sandbox-/,
  /^src\/workflow\/autonomous-run-/,
  /^src\/workspaces\//,
  /^\.github\/workflows\//,
  /^package\.json$/,
];

export interface RemediationScopeInput {
  scope: readonly string[];
  affectedWorkUnitId?: string;
}

export interface RemediationRiskAssessment {
  score: number;
  band: RemediationRiskBand;
  requiresHumanApproval: boolean;
  reasonCodes: string[];
}

export function classifyRemediationRiskBand(score: number): RemediationRiskBand {
  if (score <= 24) return "green";
  if (score <= 49) return "yellow";
  if (score <= 74) return "orange";
  return "red";
}

/**
 * Deterministic, bounded-count scoring -- no execution, no filesystem
 * scan beyond the caller-supplied scope strings. Widened/foundational
 * scope and unbounded/unknown scope raise the score; a single, narrow,
 * non-foundational file keeps it low.
 */
export function computeRemediationRisk(input: RemediationScopeInput): RemediationRiskAssessment {
  const reasonCodes: string[] = [];
  let score = 5;

  if (input.scope.length === 0) {
    score += 40;
    reasonCodes.push("EMPTY_SCOPE_UNBOUNDED_RISK");
  } else {
    score += Math.min(input.scope.length * 5, 30);
    if (input.scope.length > 1) reasonCodes.push(`SCOPE_BREADTH_${input.scope.length}_FILES`);
  }

  const touchesFoundational = input.scope.some((path) => FOUNDATIONAL_PATH_PATTERNS.some((pattern) => pattern.test(path)));
  if (touchesFoundational) {
    score += 40;
    reasonCodes.push("TOUCHES_FOUNDATIONAL_PATH");
  }

  if (!input.affectedWorkUnitId) {
    score += 15;
    reasonCodes.push("NO_BOUND_WORK_UNIT_SCOPE");
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = classifyRemediationRiskBand(clamped);
  return {
    score: clamped,
    band,
    requiresHumanApproval: clamped >= 50,
    reasonCodes,
  };
}
