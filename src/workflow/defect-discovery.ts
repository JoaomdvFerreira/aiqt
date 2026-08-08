import type { StateModel } from "../schema/state.schema.js";
import type { Checkpoint } from "../schema/checkpoint.schema.js";
import type {
  DefectConfidence,
  DefectEvidenceRef,
  DefectFreshness,
  DefectSeverity,
  DefectSourceKind,
} from "../schema/defect.schema.js";
import { computeDefectFingerprint, type DefectFingerprintInput } from "./defect-fingerprint.js";

/**
 * M42-WU02 §5: bounded discovery -- consumes only already-canonical
 * checkpoint evidence (failed validation commands, open checkpoint
 * issues/acceptance-criteria failures) and explicit human input. Never
 * scans source files or invents a defect from a broad repository sweep
 * (that is M43 scope, Section 5's own boundary).
 */
export const SUPPORTED_DISCOVERY_SOURCES: readonly DefectSourceKind[] = [
  "failed_validation",
  "checkpoint_issue",
  "human_reported",
];

export const UNSUPPORTED_DISCOVERY_SOURCES: readonly DefectSourceKind[] = [
  "review_finding",
  "autonomous_execution_failure",
  "imported_external_evidence",
];

export interface DiscoveryCandidate {
  title: string;
  summary: string;
  sourceKind: DefectSourceKind;
  evidenceRef: Omit<DefectEvidenceRef, "evidenceRefId">;
  severity: DefectSeverity;
  confidence: DefectConfidence;
  affectedWorkUnitId?: string;
  affectedMilestoneId?: string;
  affectedValidationTargets?: string[];
  freshness: DefectFreshness;
  fingerprintInput: DefectFingerprintInput;
}

export interface UnsupportedSourceResult {
  sourceKind: DefectSourceKind;
  supported: false;
  reason: string;
}

/** Section 5: unsupported sources are reported explicitly, never silently ignored. */
export function assessDiscoverySource(sourceKind: DefectSourceKind): UnsupportedSourceResult | { supported: true } {
  if (SUPPORTED_DISCOVERY_SOURCES.includes(sourceKind)) {
    return { supported: true };
  }
  return {
    sourceKind,
    supported: false,
    reason: `Discovery source "${sourceKind}" is not yet supported by M42. It is reported explicitly, not fabricated or silently skipped.`,
  };
}

function isLatestCheckpointForWorkUnit(state: StateModel, checkpoint: Checkpoint): boolean {
  const sameWorkUnit = state.checkpoints.filter((cp) => cp.workUnitId === checkpoint.workUnitId);
  const latest = sameWorkUnit[sameWorkUnit.length - 1];
  return latest?.id === checkpoint.id;
}

/**
 * Section 5's freshness rule: a checkpoint that has since been superseded
 * by a newer checkpoint for the same Work Unit is stale evidence -- it
 * must carry an explicit reason rather than being treated as a silent
 * current confirmation (Definition of Done item 1's "traceable" contract).
 */
function checkpointFreshness(state: StateModel, checkpoint: Checkpoint, now: string): DefectFreshness {
  if (isLatestCheckpointForWorkUnit(state, checkpoint)) {
    return { state: "current", evaluatedAt: now };
  }
  return {
    state: "stale",
    evaluatedAt: now,
    reason: `Checkpoint ${checkpoint.id} for ${checkpoint.workUnitId} has been superseded by a newer checkpoint.`,
  };
}

/**
 * Section 5/Section 9 WU42-02: discovers candidates from `failed_validation`
 * (checkpoint.validationCommands with result "failed"/"partial") and
 * `checkpoint_issue` (checkpoint.issues with status "open") sources.
 * `workUnitId`, when supplied, bounds discovery to that Work Unit's
 * checkpoints only -- discovery is never a full-state, unbounded scan.
 */
export function discoverFromCheckpoints(
  state: StateModel,
  now: string,
  options: { workUnitId?: string } = {},
): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  const checkpoints = options.workUnitId
    ? state.checkpoints.filter((cp) => cp.workUnitId === options.workUnitId)
    : state.checkpoints;

  for (const checkpoint of checkpoints) {
    const freshness = checkpointFreshness(state, checkpoint, now);

    for (const cmd of checkpoint.validationCommands) {
      if (cmd.result !== "failed" && cmd.result !== "partial") continue;
      const evidenceSignature = `${checkpoint.workUnitId}::validation::${cmd.command}::${cmd.result}`;
      candidates.push({
        title: `Failed validation: ${cmd.command}`,
        summary: cmd.summary ?? `Validation command "${cmd.command}" reported ${cmd.result} on checkpoint ${checkpoint.id}.`,
        sourceKind: "failed_validation",
        evidenceRef: {
          sourceKind: "failed_validation",
          locator: `checkpoint:${checkpoint.id}::validationCommands[${cmd.command}]`,
          capturedAt: checkpoint.createdAt,
          description: cmd.summary ?? undefined,
        },
        severity: cmd.result === "failed" ? "high" : "medium",
        confidence: cmd.result === "failed" ? "confirmed" : "probable",
        affectedWorkUnitId: checkpoint.workUnitId,
        affectedValidationTargets: [cmd.command],
        freshness,
        fingerprintInput: {
          sourceKind: "failed_validation",
          affectedWorkUnitId: checkpoint.workUnitId,
          affectedValidationTarget: cmd.command,
          evidenceSignature,
        },
      });
    }

    for (const [index, issue] of checkpoint.issues.entries()) {
      if (issue.status !== "open") continue;
      const evidenceSignature = `${checkpoint.workUnitId}::issue::${issue.title}`;
      candidates.push({
        title: issue.title,
        summary: issue.description ?? `Open checkpoint issue on ${checkpoint.id}: ${issue.title}`,
        sourceKind: "checkpoint_issue",
        evidenceRef: {
          sourceKind: "checkpoint_issue",
          locator: `checkpoint:${checkpoint.id}::issues[${index}]`,
          capturedAt: checkpoint.createdAt,
          description: issue.description ?? undefined,
        },
        severity: issue.severity,
        confidence: "confirmed",
        affectedWorkUnitId: checkpoint.workUnitId,
        freshness,
        fingerprintInput: {
          sourceKind: "checkpoint_issue",
          affectedWorkUnitId: checkpoint.workUnitId,
          evidenceSignature,
        },
      });
    }
  }

  return candidates;
}

export interface HumanReportedDefectInput {
  title: string;
  summary: string;
  evidenceLocator: string;
  severity: DefectSeverity;
  affectedWorkUnitId?: string;
  affectedMilestoneId?: string;
}

/**
 * Section 5: explicit human defect input with bounded evidence. Confidence
 * is always `suspected` -- a human assertion alone is not independently
 * reproduced/confirmed evidence (Section 3.2's "evidence over assertion").
 */
export function discoverFromHumanReport(input: HumanReportedDefectInput, now: string): DiscoveryCandidate {
  const evidenceSignature = `human::${input.title}::${input.evidenceLocator}`;
  return {
    title: input.title,
    summary: input.summary,
    sourceKind: "human_reported",
    evidenceRef: {
      sourceKind: "human_reported",
      locator: input.evidenceLocator,
      capturedAt: now,
    },
    severity: input.severity,
    confidence: "suspected",
    affectedWorkUnitId: input.affectedWorkUnitId,
    affectedMilestoneId: input.affectedMilestoneId,
    freshness: { state: "current", evaluatedAt: now },
    fingerprintInput: {
      sourceKind: "human_reported",
      affectedWorkUnitId: input.affectedWorkUnitId,
      evidenceSignature,
    },
  };
}

/** Computed fingerprint attached to a discovery candidate, ready for dedup. */
export function fingerprintCandidate(candidate: DiscoveryCandidate): string {
  return computeDefectFingerprint(candidate.fingerprintInput);
}
