import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";
import {
  collectIntegrityFindings,
  collectWorkflowFindings,
  collectContextFindings,
  collectQualityFindings,
  collectCheckpointFindings,
} from "../workflow/review-rules.js";
import { sortAndAssignFindingIds } from "../workflow/review-findings.js";
import { computeReviewNextCommand } from "../workflow/review-next-command.js";

export interface ReviewResult {
  findings: ReviewFinding[];
  findingCount: number;
  blockingFindingCount: number;
  warningFindingCount: number;
  infoFindingCount: number;
  recommendedExportTargets: string[];
  nextRecommendedCommand: string;
}

const RECOMMENDED_TARGET_ORDER = [
  "project-plan",
  "technical-spec",
  "status-report",
  "agent-packet",
] as const;

/**
 * recommendedExportTargets (§17.4): advisory only, computed from current
 * state, deduplicated in the stable order project-plan, technical-spec,
 * status-report, agent-packet. M6 does not support a project-summary target.
 */
export function computeRecommendedExportTargets(
  _project: ProjectModel,
  state: StateModel,
): string[] {
  const targets = new Set<string>();
  const hasWorkGraph = state.workGraph.milestones.length > 0;
  const hasCheckpoints = state.checkpoints.length > 0;

  if (!hasWorkGraph) {
    targets.add("project-plan");
  }
  if (hasWorkGraph && !hasCheckpoints) {
    targets.add("project-plan");
    targets.add("technical-spec");
  }
  if (hasCheckpoints) {
    targets.add("status-report");
    targets.add("project-plan");
  }
  if (state.lastAgentPacket) {
    targets.add("agent-packet");
  }
  if (state.projectStatus === "review") {
    targets.add("status-report");
  }

  return RECOMMENDED_TARGET_ORDER.filter((t) => targets.has(t));
}

/** Run all review rule collectors and assemble the full ReviewResult. */
export function runReview(
  project: ProjectModel,
  state: StateModel,
  knownPacketIds: readonly string[] = [],
): ReviewResult {
  const candidates = [
    ...collectIntegrityFindings(project, state, knownPacketIds),
    ...collectWorkflowFindings(project, state),
    ...collectContextFindings(project, state),
    ...collectQualityFindings(project, state),
    ...collectCheckpointFindings(project, state),
  ];

  const findings = sortAndAssignFindingIds(candidates);
  const blockingFindingCount = findings.filter((f) => f.blocking).length;
  const warningFindingCount = findings.filter(
    (f) => !f.blocking && f.severity !== "info",
  ).length;
  const infoFindingCount = findings.filter((f) => f.severity === "info").length;

  const nextRecommendedCommand = computeReviewNextCommand(project, state, findings);
  const recommendedExportTargets = computeRecommendedExportTargets(project, state);

  return {
    findings,
    findingCount: findings.length,
    blockingFindingCount,
    warningFindingCount,
    infoFindingCount,
    recommendedExportTargets,
    nextRecommendedCommand,
  };
}
