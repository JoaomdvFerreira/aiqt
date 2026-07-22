import { sha256Hex } from "../core/util/hash.js";
import { canonicalJsonStringify } from "../schema/external-evidence/canonical-json.js";
import type { WorkspaceProviderId } from "../schema/managed-workspace.schema.js";

export type WorkspaceSeriesIdentityInput =
  | {
      mode: "shared";
      projectId: string;
      providerId: WorkspaceProviderId;
      assignmentKey: string;
      implementationRoot: string;
    }
  | {
      mode: "isolated";
      projectId: string;
      providerId: WorkspaceProviderId;
      assignmentKey: string;
      baseCommit: string;
    };

/**
 * M25 §6.1: the logical workspace series key. Reuses M23's canonical-JSON
 * helper (src/schema/external-evidence/canonical-json.ts) for the tuple
 * encoding -- never a second canonical-JSON implementation. Encoding as a
 * JSON array (not string concatenation) is what prevents delimiter
 * collisions between tuple elements. Distinct from `id` (the sequential
 * canonical record ID) and from every M22/M23/M24 identity concept
 * (evidence importIdentityKey, issue key, escalation key) -- never reused
 * as any of those.
 */
export function deriveWorkspaceSeriesKey(input: WorkspaceSeriesIdentityInput): string {
  const tuple =
    input.mode === "shared"
      ? [input.projectId, input.providerId, input.assignmentKey, input.implementationRoot]
      : [input.projectId, input.providerId, input.assignmentKey, input.baseCommit];
  return sha256Hex(canonicalJsonStringify(tuple));
}

/**
 * M25 §6.3: the physical workspace-instance identity, derived from the
 * series key and the (locked, monotonic) generation. A later generation
 * for the same series always produces a distinct instance identity, which
 * is what drives a distinct path (§6.4) and branch (§6.5) for that
 * generation while the prior released instance's own record and branch
 * remain untouched.
 */
export function deriveWorkspaceInstanceIdentity(workspaceSeriesKey: string, generation: number): string {
  return sha256Hex(canonicalJsonStringify([workspaceSeriesKey, generation]));
}

/**
 * M25 §5.3: a deterministic, idempotent pending-operation ID derived from
 * the operation's own defining tuple -- never a random ID. The same
 * logical operation (same type/Work Unit/series/generation) always
 * produces the same ID, so a retried request naturally matches the
 * already-persisted pending record instead of creating a duplicate.
 */
export function derivePendingOperationId(input: {
  type: "prepare" | "release";
  workUnitId: string;
  workspaceSeriesKey: string;
  generation: number;
}): string {
  return sha256Hex(
    canonicalJsonStringify([input.type, input.workUnitId, input.workspaceSeriesKey, input.generation]),
  );
}

export interface GenerationResolutionInput {
  lifecycleStatus: "ready" | "released";
  generation: number;
  id: string;
}

export interface PendingPrepareGenerationInput {
  generation: number;
  id: string;
}

export type GenerationResolution =
  | { action: "reuse_active_workspace"; generation: number; existingWorkspaceId: string }
  | { action: "reuse_pending_generation"; generation: number; existingPendingOperationId: string }
  | { action: "allocate"; generation: number };

/**
 * M25 §6.2: must be evaluated while holding the workspace-operation lock
 * (WU25-05 owns lock acquisition; this function is the pure decision
 * logic reused by prepare and by recovery). An active workspace for the
 * series is reused idempotently; a pending prepare's reserved generation
 * is reused (never re-allocated); otherwise the next generation is one
 * more than the highest existing generation for the series (starting at
 * 1), regardless of gaps left by historical records.
 */
export function resolveGenerationForSeries(
  existingWorkspacesForSeries: readonly GenerationResolutionInput[],
  existingPendingPreparesForSeries: readonly PendingPrepareGenerationInput[],
): GenerationResolution {
  const active = existingWorkspacesForSeries.find((w) => w.lifecycleStatus === "ready");
  if (active) {
    return { action: "reuse_active_workspace", generation: active.generation, existingWorkspaceId: active.id };
  }
  const pending = existingPendingPreparesForSeries[0];
  if (pending) {
    return {
      action: "reuse_pending_generation",
      generation: pending.generation,
      existingPendingOperationId: pending.id,
    };
  }
  const maxGeneration = existingWorkspacesForSeries.reduce((max, w) => Math.max(max, w.generation), 0);
  return { action: "allocate", generation: maxGeneration + 1 };
}
