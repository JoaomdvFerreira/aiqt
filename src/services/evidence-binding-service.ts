import type { EvidenceRecord, EvidenceBindingStatus } from "../schema/evidence.schema.js";

/**
 * M22 §5.8: facts about the *current* workflow/code state, gathered by the
 * caller through whatever means it already uses (no inspection is
 * performed here -- this module never spawns a process, reads the
 * filesystem, or calls a network). `inspectable: false` means the caller
 * could not determine current repository state at all.
 */
export interface EvidenceBindingCurrentFacts {
  workUnitId: string;
  packetId: string;
  implementationRootId: string;
  commitSha?: string;
  repositoryFingerprint?: string;
  workingTreeFingerprint?: string;
  inspectable: boolean;
}

/**
 * M22 §5.8: pure, deterministic derived evaluator. Stores no state and
 * mutates nothing -- repeated evaluation of the same inputs always
 * produces the same result.
 *
 * Rules, in order:
 * 1. current state not inspectable -> unavailable
 * 2. workUnitId/packetId/implementationRootId mismatch -> mismatched
 * 3. no shared, comparable code-binding fact -> unknown
 * 4. a known, comparable code-state fact changed -> stale
 * 5. one or more comparable facts all match -> current
 */
export function evaluateEvidenceBinding(
  evidence: EvidenceRecord,
  current: EvidenceBindingCurrentFacts,
): EvidenceBindingStatus {
  if (!current.inspectable) return "unavailable";

  const wb = evidence.workflowBinding;
  if (
    wb.workUnitId !== current.workUnitId ||
    wb.packetId !== current.packetId ||
    wb.implementationRootId !== current.implementationRootId
  ) {
    return "mismatched";
  }

  const cb = evidence.codeBinding;
  const comparable = [
    [cb.commitSha, current.commitSha],
    [cb.repositoryFingerprint, current.repositoryFingerprint],
    [cb.workingTreeFingerprint, current.workingTreeFingerprint],
  ].filter((pair): pair is [string, string] => pair[0] !== undefined && pair[1] !== undefined);
  if (comparable.length === 0) return "unknown";
  const changed = comparable.some(([stored, target]) => stored !== target);
  if (changed) return "stale";

  return "current";
}
