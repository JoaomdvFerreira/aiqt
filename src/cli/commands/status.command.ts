import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import type { Issue } from "../../core/output/issue.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { loadProject } from "./load-project.js";
import { workUnitCountsByStatus } from "../../workflow/statuses.js";
import { resolveRoots } from "../../workflow/root-resolution.js";
import { computeEffectiveReadinessForState } from "../../workflow/effective-readiness.js";
import { deriveEffectiveExecutionMetadata } from "../../workflow/execution-metadata-defaults.js";
import { buildParallelBatch } from "../../workflow/parallel-batch.js";
import { computeWorkspaceReadiness } from "../../workflow/workspace-readiness-advisory.js";
import type { ParallelStatusData } from "../../services/parallel-status-template.js";
import type { StateModel } from "../../schema/state.schema.js";
import { getActivePolicyRef } from "../../services/evidence-gate-policy-service.js";
import { computeEvidenceAdvisoryTelemetry } from "../../workflow/evidence-advisory-telemetry.js";
import { buildRequiredEvidenceVisibilitySummary } from "../../workflow/required-evidence-visibility.js";
import { assessWorkflow } from "../../workflow/workflow-assessment.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";
import { runReview } from "../../services/review-service.js";
import { classifyFindings } from "../../services/manage-service.js";

export interface RunStatusOptions {
  /** M24 §11: read-only advisory eligibility/batch reporting -- never mutates state or runlog. */
  parallel?: boolean;
}

/**
 * M24 §11.3: structurally invalid execution metadata, a broken
 * dependency reference, or an empty (0-count) graph edge case all remain
 * read-only -- this function only ever inspects `state`, never writes.
 */
function buildParallelStatusResult(state: StateModel, implementationRoot: string): CommandResult {
  const workUnitIds = new Set(state.workGraph.workUnits.map((wu) => wu.id));
  const brokenDependency = state.workGraph.dependencies.find(
    (d) => !workUnitIds.has(d.fromId) || !workUnitIds.has(d.toId),
  );
  if (brokenDependency) {
    const message = `Broken dependency reference: "${brokenDependency.id}" references a work unit that does not exist in the graph.`;
    return makeResult({
      status: "failed",
      action: "status",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: message,
      exitCode: ExitCode.InvalidInput,
      blockingIssues: [
        {
          id: "STATUS-PARALLEL-BROKEN-DEPENDENCY",
          severity: "critical",
          area: "graph",
          message,
          agentCanFix: false,
        },
      ],
    });
  }

  let complete = 0;
  let missing = 0;
  let invalid = 0;
  for (const workUnit of state.workGraph.workUnits) {
    const effective = deriveEffectiveExecutionMetadata(workUnit);
    if (effective.metadataStatus === "complete") complete += 1;
    else if (effective.metadataStatus === "missing") missing += 1;
    else invalid += 1;
  }

  if (invalid > 0) {
    const message = `${invalid} work unit(s) have structurally invalid execution metadata in canonical state.`;
    return makeResult({
      status: "failed",
      action: "status",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: message,
      exitCode: ExitCode.InvalidInput,
      blockingIssues: [
        {
          id: "STATUS-PARALLEL-INVALID-METADATA",
          severity: "critical",
          area: "graph",
          message,
          agentCanFix: false,
        },
      ],
    });
  }

  const readyWorkUnitIds = [...computeEffectiveReadinessForState(state).values()]
    .filter((r) => r.effectivelyReady)
    .map((r) => r.workUnitId)
    .sort();
  const batch = buildParallelBatch(state);
  const workspaceReadiness = computeWorkspaceReadiness(state, readyWorkUnitIds, implementationRoot);

  const parallelStatus: ParallelStatusData = {
    advisory: true,
    activeWorkUnitIds: batch.activeWorkUnitIds,
    readyWorkUnitIds,
    recommendedBatch: batch.selectedWorkUnitIds,
    manualReviewWorkUnitIds: batch.manualReviewWorkUnitIds,
    excluded: batch.excluded,
    metadataCoverage: { complete, missing, invalid },
    workspaceReadiness,
  };

  const summary = `Parallel execution advisory: ${batch.activeWorkUnitIds.length} active, ${readyWorkUnitIds.length} ready, ${batch.selectedWorkUnitIds.length} recommended, ${batch.manualReviewWorkUnitIds.length} needing manual review, ${batch.excluded.length} excluded. Advisory only -- no workspace was created and no Work Unit was started.`;

  return makeResult({
    status: "passed",
    action: "status",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary,
    nextRecommendedCommand: null,
    exitCode: ExitCode.Success,
    data: { parallelStatus },
  });
}

export function runStatus(ctx: CommandContext, options: RunStatusOptions = {}): CommandResult {
  try {
    const { paths, project, state, runlogHealth, warnings } = loadProject(ctx);

    if (options.parallel) {
      const roots = resolveRoots({ controlRoot: ctx.cwd, existingRepositoryPath: project.project.existingRepositoryPath });
      return buildParallelStatusResult(state, roots.implementationRoot);
    }

    const review = runReview(project, state, readAgentPacketIds(paths.runlogFile, state.lastAgentPacket));
    const classification = classifyFindings(project, state, review);
    const allWorkUnitStatusesDone =
      state.workGraph.workUnits.length > 0 &&
      state.workGraph.workUnits.every((wu) => wu.status === "done");
    const assessment = assessWorkflow(project, state, {
      productionReady: allWorkUnitStatusesDone ? classification.productionReady : null,
    });
    const next = {
      nextRecommendedCommand: assessment.recommendedCommand,
      reason: assessment.recommendationReason,
      warnings: [] as Issue[],
    };
    const workUnitCounts = workUnitCountsByStatus(state);
    const milestoneCount = state.workGraph.milestones.length;
    const workUnitCount = state.workGraph.workUnits.length;

    // M18 §9: additive effective-readiness counts alongside the canonical
    // status counts above. `ready` remains the canonical stored count;
    // `effectivelyReady` is the actionable execution count; `staleReady` is
    // the number of canonical-ready units blocked by an active dependency.
    const readiness = [...computeEffectiveReadinessForState(state).values()];
    const effectivelyReadyCount = readiness.filter((r) => r.effectivelyReady).length;
    const staleReadyCount = readiness.filter(
      (r) => r.canonicalStatus === "ready" && !r.effectivelyReady,
    ).length;
    const workUnitCountsWithReadiness = {
      ...workUnitCounts,
      effectivelyReady: effectivelyReadyCount,
      staleReady: staleReadyCount,
    };

    // M16 §10: status displays the runtime control root and resolved
    // implementation root alongside the existing project summary.
    const roots = resolveRoots({
      controlRoot: paths.root,
      existingRepositoryPath: project.project.existingRepositoryPath,
    });

    // M21-WU08 §5.8/§9: an external/missing/unreadable implementation root
    // is a deterministic, non-blocking warning -- it never changes
    // `projectStatus`, `nextRecommendedCommand`, or `exitCode` (still 0
    // below), and no command execution happens at the root to produce it.
    const rootWarnings: Issue[] = roots.diagnostics.warning
      ? [
          {
            id: "STATUS-IMPLEMENTATION-ROOT-DIAGNOSTIC",
            severity: "low",
            area: "roots",
            message: roots.diagnostics.warning,
            suggestedAction:
              "Verify existingRepositoryPath in project.json points at the intended implementation repository.",
            agentCanFix: false,
          },
        ]
      : [];
    const allWarnings = [...warnings, ...next.warnings, ...rootWarnings];

    const summary = `Project "${project.project.name}" is ${assessment.projectStatus} with ${milestoneCount} milestone(s) and ${workUnitCount} work unit(s). AIQT control root: ${roots.controlRoot}. Implementation root: ${roots.implementationRoot}.`;

    // M28 §6/M29 §6: read-only, additive. Only present when policy
    // configuration exists; never simulates implicitly -- the aggregate
    // advisory counts below are derived entirely from already-persisted
    // canonical state and runlog history, never a fresh evaluation.
    const activePolicyRef = getActivePolicyRef(state);
    const advisoryTelemetry = state.evidenceGate || (state.checkpointEvidenceAdvisories?.length ?? 0) > 0
      ? computeEvidenceAdvisoryTelemetry(state, paths.runlogFile)
      : undefined;
    const evidenceGateSummary = state.evidenceGate
      ? {
          activePolicy: activePolicyRef ?? null,
          simulationEnforced: false as const,
          checkpointAdvisoryIntegrated: true as const,
          ...(advisoryTelemetry ? { advisory: advisoryTelemetry } : {}),
        }
      : undefined;

    return makeResult({
      status: allWarnings.length > 0 ? "warning" : "passed",
      action: "status",
      projectStatus: assessment.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary,
      warnings: allWarnings,
      nextRecommendedCommand: next.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        projectName: project.project.name,
        projectStatus: assessment.projectStatus,
        milestoneCount,
        workUnitCount,
        workUnitCounts: workUnitCountsWithReadiness,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        nextActionReason: next.reason,
        runlogHealth,
        roots,
        ...(evidenceGateSummary ? { evidenceGate: evidenceGateSummary } : {}),
        // M30 §10.3: one centralized required-evidence projection, shared
        // with manage/export. Purely derived from persisted state -- never
        // a fresh evaluation, never blocking.
        requiredEvidence: buildRequiredEvidenceVisibilitySummary(state),
      },
    });
  } catch (err) {
    return errorToResult("status", err);
  }
}
