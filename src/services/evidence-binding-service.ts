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
 * 3. no code-binding facts on either side -> unknown
 * 4. a known, comparable code-state fact changed -> stale
 * 5. otherwise -> current
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
  const hasStoredCodeFact = Boolean(cb.commitSha ?? cb.repositoryFingerprint ?? cb.workingTreeFingerprint);
  const hasCurrentCodeFact = Boolean(
    current.commitSha ?? current.repositoryFingerprint ?? current.workingTreeFingerprint,
  );
  if (!hasStoredCodeFact || !hasCurrentCodeFact) return "unknown";

  const changed =
    (cb.commitSha !== undefined && current.commitSha !== undefined && cb.commitSha !== current.commitSha) ||
    (cb.repositoryFingerprint !== undefined &&
      current.repositoryFingerprint !== undefined &&
      cb.repositoryFingerprint !== current.repositoryFingerprint) ||
    (cb.workingTreeFingerprint !== undefined &&
      current.workingTreeFingerprint !== undefined &&
      cb.workingTreeFingerprint !== current.workingTreeFingerprint);
  if (changed) return "stale";

  return "current";
}
