import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { WorkspaceMode, WorkspaceAccess, ParallelMode } from "../schema/execution-metadata.schema.js";
import { ELIGIBILITY_REASONS_PER_PAIR_MAX } from "../schema/execution-metadata.schema.js";
import { deriveEffectiveExecutionMetadata, isActiveOccupancyStatus } from "./execution-metadata-defaults.js";
import { computeEffectiveReadinessForState } from "./effective-readiness.js";
import { evaluateParallelEligibility, type EligibilityReason } from "./parallel-eligibility.js";

export interface ExecutionMetadataAdvisory {
  workspace: {
    mode: WorkspaceMode | "unknown";
    assignmentKey?: string;
    access?: WorkspaceAccess;
  };
  parallel: {
    mode: ParallelMode;
    concurrencyGroup?: string;
    resourceClaimCount: number;
    compatibleWithActiveWork: boolean;
    advisoryReasons: EligibilityReason[];
  };
  metadataDeclared: boolean;
}

/**
 * M24 §13: builds the bounded advisory data for the current Work Unit's
 * handoff packet. `compatibleWithActiveWork` reuses the exact WU24-04
 * evaluator against every OTHER currently active (in_progress/
 * needs_review) work unit -- never a second compatibility algorithm.
 * Read-only: never mutates `state`.
 */
export function buildExecutionMetadataAdvisory(workUnit: WorkUnit, state: StateModel): ExecutionMetadataAdvisory {
  const effective = deriveEffectiveExecutionMetadata(workUnit);
  const activeWorkUnits = state.workGraph.workUnits.filter(
    (wu) => wu.id !== workUnit.id && isActiveOccupancyStatus(wu.status),
  );
  const readiness = computeEffectiveReadinessForState(state);
  const context = {
    dependencies: state.workGraph.dependencies,
    readiness,
    activeWorkUnitIds: new Set(activeWorkUnits.map((wu) => wu.id)),
  };

  const reasons = new Set<EligibilityReason>();
  let compatible = true;
  for (const active of activeWorkUnits) {
    const result = evaluateParallelEligibility(workUnit, active, context);
    if (!result.eligible) {
      compatible = false;
      for (const reason of result.reasons) reasons.add(reason);
    }
  }

  return {
    workspace: {
      mode: effective.workspaceAssignment.mode,
      assignmentKey: effective.workspaceAssignment.assignmentKey,
      access: effective.workspaceAssignment.access,
    },
    parallel: {
      mode: effective.parallelPolicy.mode,
      concurrencyGroup: effective.parallelPolicy.concurrencyGroup,
      resourceClaimCount: effective.parallelPolicy.resourceClaims.length,
      compatibleWithActiveWork: compatible,
      advisoryReasons: [...reasons].sort().slice(0, ELIGIBILITY_REASONS_PER_PAIR_MAX),
    },
    metadataDeclared: effective.metadataStatus === "complete",
  };
}

/**
 * M24 §13: renders the one bounded, additive packet section. Explicitly
 * advisory wording throughout; never states or implies that a physical
 * workspace, branch, or worktree exists, and never authorizes execution.
 */
export function renderExecutionMetadataAdvisorySection(advisory: ExecutionMetadataAdvisory): string {
  const lines: string[] = [];
  lines.push("## Workspace and Parallel Execution Advisory");
  lines.push("");
  lines.push(
    "Advisory metadata only -- no physical workspace has been created, and this packet does not authorize creating a branch, worktree, or any other execution environment.",
  );
  lines.push("");
  lines.push(`- Workspace mode: ${advisory.workspace.mode}`);
  if (advisory.workspace.assignmentKey !== undefined) {
    lines.push(`- Logical assignment key (not a physical path): ${advisory.workspace.assignmentKey}`);
  }
  if (advisory.workspace.access !== undefined) {
    lines.push(`- Access: ${advisory.workspace.access}`);
  }
  lines.push(`- Parallel policy: ${advisory.parallel.mode}`);
  if (advisory.parallel.concurrencyGroup !== undefined) {
    lines.push(`- Concurrency group: ${advisory.parallel.concurrencyGroup}`);
  }
  lines.push(`- Resource claims declared: ${advisory.parallel.resourceClaimCount}`);
  lines.push(`- Compatible with currently active work: ${advisory.parallel.compatibleWithActiveWork}`);
  if (advisory.parallel.advisoryReasons.length > 0) {
    lines.push(`- Advisory reasons: ${advisory.parallel.advisoryReasons.join(", ")}`);
  }
  if (!advisory.metadataDeclared) {
    lines.push(
      "- No M24 execution metadata is declared for this work unit; it is treated as serialized and is never automatically eligible for parallel execution.",
    );
  }
  return lines.join("\n");
}
