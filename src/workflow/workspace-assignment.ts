import type { WorkUnit } from "../schema/work-unit.schema.js";
import { isTerminalWorkUnitStatus, deriveEffectiveExecutionMetadata } from "./execution-metadata-defaults.js";

/**
 * M24 §4.3: an isolated assignment key must be unique across every
 * non-terminal Work Unit in the candidate graph (shared keys may repeat
 * freely). Returns the reused keys, in first-seen order, for a caller to
 * report; an empty array means the candidate graph is valid on this axis.
 */
export function findDuplicateIsolatedAssignmentKeys(workUnits: readonly WorkUnit[]): string[] {
  const workUnitIdsByKey = new Map<string, string[]>();
  for (const workUnit of workUnits) {
    if (isTerminalWorkUnitStatus(workUnit.status)) continue;
    const effective = deriveEffectiveExecutionMetadata(workUnit);
    if (effective.workspaceAssignment.mode !== "isolated") continue;
    const key = effective.workspaceAssignment.assignmentKey;
    if (!key) continue;
    const list = workUnitIdsByKey.get(key) ?? [];
    list.push(workUnit.id);
    workUnitIdsByKey.set(key, list);
  }
  const duplicates: string[] = [];
  for (const [key, ids] of workUnitIdsByKey) {
    if (ids.length > 1) duplicates.push(key);
  }
  return duplicates;
}

export interface IsolatedAssignmentKeyValidation {
  ok: boolean;
  duplicateKeys: string[];
}

/**
 * M24 §12/§19.10: validated over the FULL candidate work-unit list (every
 * existing plus every newly added/replanned Work Unit) before any
 * plan/import/extend/refine mutation is persisted -- never deferred to
 * pairwise eligibility evaluation.
 */
export function validateIsolatedAssignmentKeyUniqueness(
  workUnits: readonly WorkUnit[],
): IsolatedAssignmentKeyValidation {
  const duplicateKeys = findDuplicateIsolatedAssignmentKeys(workUnits);
  return { ok: duplicateKeys.length === 0, duplicateKeys };
}
