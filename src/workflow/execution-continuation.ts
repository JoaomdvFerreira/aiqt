import type { Checkpoint } from "../schema/checkpoint.schema.js";
import type { ContinuationCapsule } from "../schema/execution-guidance.schema.js";

/**
 * M39-WU02 (build spec Sec 6, "Continuation capsule"): a pure, bounded
 * derivation from canonical checkpoint evidence -- never chat/session
 * history, never a repository dump, never a second source of truth for
 * facts a checkpoint already records. Reuses `Checkpoint.summary`,
 * `filesChanged`, `validationResult`, `acceptanceCriteriaResult`, and
 * `issues` verbatim; no new checkpoint field was needed (build spec Sec
 * 6: add one only if live-code review proves a required carry-forward
 * reference cannot otherwise be represented -- it can).
 */

const MAX_SUMMARY_CHARS = 500;
const MAX_CHANGED_FILES = 50;
const MAX_ISSUE_TITLES = 20;

export interface DirectDependencyCheckpointInput {
  workUnitId: string;
  /** `null` when the dependency has no checkpoint yet (e.g. still in progress) -- contributes nothing rather than failing. */
  checkpoint: Checkpoint | null;
}

export interface BuildContinuationCapsuleInput {
  directDependencies: readonly DirectDependencyCheckpointInput[];
  /** The current Work Unit's own most recent checkpoint, if this is a resumed/needs_review Work Unit. Only its open issues are carried forward. */
  currentWorkUnitPriorCheckpoint?: Checkpoint | null;
  carryForwardRefs?: readonly string[];
}

/** Deterministic, bounded truncation -- continuation is meant to be compact; unlike the context manifest's must-read rule, shortening here is expected, not a silent-loss hazard. */
function boundedJoin(parts: readonly string[], maxChars: number): string | null {
  if (parts.length === 0) return null;
  const joined = parts.join("; ");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function buildContinuationCapsule(input: BuildContinuationCapsuleInput): ContinuationCapsule {
  const resolvedDependencies = input.directDependencies.filter(
    (dep): dep is { workUnitId: string; checkpoint: Checkpoint } => dep.checkpoint != null,
  );

  const previousCheckpointSummary = boundedJoin(
    resolvedDependencies.map((dep) => `${dep.workUnitId}: ${dep.checkpoint.summary}`),
    MAX_SUMMARY_CHARS,
  );

  const filesChangedSet = new Map<string, true>();
  for (const dep of resolvedDependencies) {
    for (const file of dep.checkpoint.filesChanged) filesChangedSet.set(file, true);
  }
  const filesChangedByDependencies = [...filesChangedSet.keys()].sort().slice(0, MAX_CHANGED_FILES);

  const dependencyValidationResult = boundedJoin(
    resolvedDependencies.map((dep) => `${dep.workUnitId}: ${dep.checkpoint.validationResult}/${dep.checkpoint.acceptanceCriteriaResult}`),
    MAX_SUMMARY_CHARS,
  );

  const openIssueTitles = new Map<string, true>();
  for (const dep of resolvedDependencies) {
    for (const issue of dep.checkpoint.issues) {
      if (issue.status === "open") openIssueTitles.set(issue.title, true);
    }
  }
  if (input.currentWorkUnitPriorCheckpoint) {
    for (const issue of input.currentWorkUnitPriorCheckpoint.issues) {
      if (issue.status === "open") openIssueTitles.set(issue.title, true);
    }
  }
  const unresolvedIssueTitles = [...openIssueTitles.keys()].slice(0, MAX_ISSUE_TITLES);

  const carryForwardRefs = [...new Set(input.carryForwardRefs ?? [])].sort();

  return {
    previousCheckpointSummary,
    filesChangedByDependencies,
    dependencyValidationResult,
    unresolvedIssueTitles,
    carryForwardRefs,
  };
}
