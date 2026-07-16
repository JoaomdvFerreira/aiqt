import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import {
  collectIntegrityFindings,
  collectDependencyCycleFindings,
  type ReviewFindingCandidate,
} from "../workflow/review-rules.js";
import { collectGraphAndPlanQualityWarnings } from "../workflow/warning-rules.js";

export interface GraphValidationIssue {
  rule: string;
  workUnitId?: string;
  dependencyId?: string;
  message: string;
}

export interface GraphValidationResult {
  blockingErrors: GraphValidationIssue[];
  warnings: GraphValidationIssue[];
}

/**
 * Maps a ReviewFindingCandidate's internal ruleKey (family.rule[.entityId])
 * to the short, stable rule slug used in aiqt graph validate/repair output.
 * Deliberately curated to only the rules graph-validation-service actually
 * surfaces; unmapped keys fall back to the raw ruleKey rather than throwing,
 * since an unrecognized rule is still safe (if less polished) to display.
 */
const RULE_SLUGS: Record<string, string> = {
  "integrity.broken-milestone": "broken-milestone-reference",
  "integrity.broken-dependency": "broken-dependency-reference",
  "integrity.missing-current-work-unit": "broken-current-work-unit-reference",
  "integrity.missing-packet-work-unit": "broken-packet-work-unit-reference",
  "integrity.checkpoint-missing-work-unit": "broken-checkpoint-work-unit-reference",
  "integrity.checkpoint-missing-packet": "broken-checkpoint-packet-reference",
  "integrity.invalid-replanned-metadata": "invalid-replanned-work-unit",
  "integrity.dependency-cycle": "dependency-cycle",
  "warning.suspicious-late-stage-ready": "suspicious-late-stage-ready",
  "warning.mixed-inbound-dependency": "mixed-inbound-dependency-types",
  "warning.orphaned-requirement-fragment": "possible-orphaned-requirement-fragment",
  "warning.stale-readiness": "stale-readiness",
  "warning.late-stage-relates-to": "late-stage-relates-to",
};

function ruleSlug(ruleKey: string): string {
  const withoutEntityId = ruleKey.split(".").slice(0, -1).join(".");
  return RULE_SLUGS[ruleKey] ?? RULE_SLUGS[withoutEntityId] ?? ruleKey;
}

function firstMatching(relatedIds: readonly string[], prefix: string): string | undefined {
  return relatedIds.find((id) => id.startsWith(prefix));
}

function toGraphIssue(finding: ReviewFindingCandidate): GraphValidationIssue {
  const issue: GraphValidationIssue = {
    rule: ruleSlug(finding.ruleKey),
    message: finding.message,
  };
  const workUnitId = firstMatching(finding.relatedIds, "WU");
  const dependencyId = firstMatching(finding.relatedIds, "DEP");
  if (workUnitId !== undefined) issue.workUnitId = workUnitId;
  if (dependencyId !== undefined) issue.dependencyId = dependencyId;
  return issue;
}

/**
 * M12 §8.3: read-only graph structure and readiness validation. Reuses the
 * existing M9/M10/M12 review and warning collectors rather than forking a
 * second implementation -- broken references and dependency cycles become
 * blockingErrors (both already blocking:true candidates); the shared
 * graph/plan-quality warning collector (mixed inbound types, suspicious
 * late-stage readiness, stale readiness, late-stage relates_to) becomes
 * warnings. Never mutates state or appends a runlog event.
 */
export function validateGraph(
  project: ProjectModel,
  state: StateModel,
  knownPacketIds: readonly string[],
): GraphValidationResult {
  const blockingCandidates = [
    ...collectIntegrityFindings(project, state, knownPacketIds),
    ...collectDependencyCycleFindings(state),
  ];
  const warningCandidates = collectGraphAndPlanQualityWarnings(project, state);

  return {
    blockingErrors: blockingCandidates.map(toGraphIssue),
    warnings: warningCandidates.map(toGraphIssue),
  };
}
