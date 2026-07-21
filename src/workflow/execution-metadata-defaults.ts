import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type {
  WorkspaceMode,
  WorkspaceAccess,
  ParallelMode,
  ResourceClaim,
} from "../schema/execution-metadata.schema.js";
import { ExecutionMetadataSchema } from "../schema/execution-metadata.schema.js";

/**
 * M24 §8.2: no repository-wide "terminal status" owner existed prior to
 * M24 (Gate D finding). Derived here, once, for M24's own occupancy/
 * isolated-key-uniqueness scope: `done` (finished), `replanned`
 * (superseded by its `replacedByWorkUnitIds`), and `cancelled` (abandoned)
 * are the statuses that can never again occupy execution resources or
 * require workspace-assignment-key uniqueness. This is a minimal, additive
 * derivation, not a duplicate of an existing concept -- reused by every
 * M24 module that needs it, never reimplemented.
 */
export const TERMINAL_WORK_UNIT_STATUSES: ReadonlySet<WorkUnitStatus> = new Set([
  "done",
  "replanned",
  "cancelled",
]);

export function isTerminalWorkUnitStatus(status: WorkUnitStatus): boolean {
  return TERMINAL_WORK_UNIT_STATUSES.has(status);
}

/** M24 §8.2 (Gate D verified): statuses that occupy execution resources for active-occupancy/pairwise-conflict purposes. */
export const ACTIVE_OCCUPANCY_STATUSES: ReadonlySet<WorkUnitStatus> = new Set([
  "in_progress",
  "needs_review",
]);

export function isActiveOccupancyStatus(status: WorkUnitStatus): boolean {
  return ACTIVE_OCCUPANCY_STATUSES.has(status);
}

export type MetadataStatus = "complete" | "missing" | "invalid";

export interface EffectiveWorkspaceAssignment {
  mode: WorkspaceMode | "unknown";
  assignmentKey?: string;
  access?: WorkspaceAccess;
}

export interface EffectiveParallelPolicy {
  mode: ParallelMode;
  concurrencyGroup?: string;
  resourceClaims: ResourceClaim[];
}

export interface EffectiveExecutionMetadata {
  workUnitId: string;
  metadataStatus: MetadataStatus;
  workspaceAssignment: EffectiveWorkspaceAssignment;
  parallelPolicy: EffectiveParallelPolicy;
  /** M24 §7: true only when metadata is present, structurally valid, and parallelPolicy.mode is not "serialized" -- this field never grants execution authorization by itself. */
  automaticEligibilityPossible: boolean;
}

/**
 * M24 §7 (Conservative Historical Defaults): a Work Unit with no
 * `executionMetadata` at all is NOT an error -- it derives to
 * `workspaceAssignment: unknown` / `parallelPolicy.mode: serialized` /
 * never automatically eligible, exactly the same as every pre-M24 Work
 * Unit. This function never writes the derived default back onto the
 * Work Unit (no read-time materialization) -- it is a pure read-side
 * projection recomputed on every call.
 *
 * `metadataStatus: "invalid"` is a defense-in-depth path: the M24 schema
 * (ExecutionMetadataSchema's cross-field superRefine) already rejects the
 * intrinsic `none`+write/exclusive contradiction at the WorkUnitSchema
 * level, so this should be unreachable via any legitimate plan/import/
 * extend/refine path. It exists so that read-only evaluation over
 * already-invalid canonical state (e.g. a hand-edited state.json that
 * bypassed the schema) reports `invalid_execution_metadata` instead of
 * silently trusting or crashing on the contradiction.
 */
export function deriveEffectiveExecutionMetadata(workUnit: WorkUnit): EffectiveExecutionMetadata {
  const workUnitId = workUnit.id;
  const raw = workUnit.executionMetadata;

  if (raw === undefined) {
    return {
      workUnitId,
      metadataStatus: "missing",
      workspaceAssignment: { mode: "unknown" },
      parallelPolicy: { mode: "serialized", resourceClaims: [] },
      automaticEligibilityPossible: false,
    };
  }

  const revalidation = ExecutionMetadataSchema.safeParse(raw);
  if (!revalidation.success) {
    return {
      workUnitId,
      metadataStatus: "invalid",
      workspaceAssignment: { mode: "unknown" },
      parallelPolicy: { mode: "serialized", resourceClaims: [] },
      automaticEligibilityPossible: false,
    };
  }

  const workspaceAssignment: EffectiveWorkspaceAssignment = raw.workspaceAssignment
    ? {
        mode: raw.workspaceAssignment.mode,
        assignmentKey: raw.workspaceAssignment.assignmentKey,
        access: raw.workspaceAssignment.access,
      }
    : { mode: "unknown" };

  const parallelMode = raw.parallelPolicy?.mode ?? "serialized";
  const parallelPolicy: EffectiveParallelPolicy = {
    mode: parallelMode,
    concurrencyGroup: raw.parallelPolicy?.concurrencyGroup,
    resourceClaims: raw.parallelPolicy?.resourceClaims ?? [],
  };

  return {
    workUnitId,
    metadataStatus: "complete",
    workspaceAssignment,
    parallelPolicy,
    automaticEligibilityPossible: parallelMode === "eligible_if_no_conflict",
  };
}
