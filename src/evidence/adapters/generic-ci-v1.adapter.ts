import type { GenericCiV1, CiStatus, Check } from "../../schema/external-evidence/generic-ci-v1.schema.js";
import type {
  NormalizedEvidenceCandidate,
  AdapterNormalizationResult,
} from "../../schema/external-evidence/normalized-evidence-candidate.js";
import type { SourceFinding, ArtifactReference, ReviewOutcome, AcceptanceOutcome, TrustLevel } from "../../schema/evidence.schema.js";
import { computeSourceFingerprint } from "../../workflow/finding-fingerprint.js";
import {
  mapExternalFindingToSourceFinding,
  mapExternalArtifactToArtifactReference,
} from "./generic-evidence-v1.adapter.js";

export const GENERIC_CI_V1_ADAPTER_ID = "generic-ci-json@1";

/** M23 §12 trust ceiling: fixed by the adapter, never elevated by the payload. */
export const GENERIC_CI_V1_TRUST_LEVEL: TrustLevel = "self_reported";

/** M23 §10 Critical rule 2: fixed run.status -> mappedRunStatus mapping table. `cancelled` is conservatively folded into `partial`. */
const RUN_STATUS_MAP: Readonly<Record<CiStatus, CiStatus>> = {
  passed: "passed",
  failed: "failed",
  partial: "partial",
  cancelled: "partial",
  not_run: "not_run",
  unknown: "unknown",
};

export function mapRunStatus(status: CiStatus): CiStatus {
  return RUN_STATUS_MAP[status];
}

/**
 * M23 §10 Critical rule 2: aggregates the `checks[]` array independently of
 * `run.status` -- failed if any check failed; else partial if any check is
 * partial/cancelled; else passed only if checks is non-empty and all
 * passed; else not_run only if checks is non-empty and all not_run; else
 * unknown (including the empty-checks case, where nothing can be
 * concluded).
 */
export function computeChecksAggregate(checks: readonly Check[]): CiStatus {
  if (checks.some((c) => c.status === "failed")) return "failed";
  if (checks.some((c) => c.status === "partial" || c.status === "cancelled")) return "partial";
  if (checks.length > 0 && checks.every((c) => c.status === "passed")) return "passed";
  if (checks.length > 0 && checks.every((c) => c.status === "not_run")) return "not_run";
  return "unknown";
}

/**
 * M23 §10 Critical rule 2: conservative reconciliation of the two
 * independent signals. Disagreement is handled by the caller (a bounded
 * warning plus a deterministic SourceFinding) -- this function only ever
 * returns the conservative result, never silently defaulting to `passed`.
 */
export function reconcileCiStatus(mappedRunStatus: CiStatus, checksAggregate: CiStatus): CiStatus {
  if (mappedRunStatus === "failed" || checksAggregate === "failed") return "failed";
  if (mappedRunStatus === "partial" || checksAggregate === "partial") return "partial";
  if (mappedRunStatus === "passed" && checksAggregate === "passed") return "passed";
  if (mappedRunStatus === "not_run" && checksAggregate === "not_run") return "not_run";
  return "unknown";
}

/** Reconciled/mapped CiStatus values never include `cancelled`, so the value space matches ReviewOutcome exactly. */
function toReviewOutcome(status: CiStatus): ReviewOutcome {
  return status as Exclude<CiStatus, "cancelled">;
}

/** AcceptanceOutcome has no `not_run` member; CI's "no result yet" maps to "not_checked". */
function toAcceptanceOutcome(status: CiStatus): AcceptanceOutcome {
  return status === "not_run" ? "not_checked" : (status as Exclude<CiStatus, "cancelled" | "not_run">);
}

const RECONCILIATION_DISAGREEMENT_FINDING_ID = "ci-reconciliation-disagreement";

function buildDisagreementFinding(
  reportedStatus: CiStatus,
  mappedRunStatus: CiStatus,
  checksAggregate: CiStatus,
  reconciled: CiStatus,
): SourceFinding {
  const title = "CI run status disagrees with aggregated check status";
  const summary = `Reported run.status '${reportedStatus}' (mapped: '${mappedRunStatus}') does not agree with the status aggregated from individual checks ('${checksAggregate}'). Using the conservative reconciled result '${reconciled}'.`;
  return {
    sourceFindingId: RECONCILIATION_DISAGREEMENT_FINDING_ID,
    sourceFingerprint: computeSourceFingerprint({
      title,
      summary,
      relatedIds: [],
      scopeClaim: "execution_local",
    }),
    title,
    summary,
    sourceSeverityClaim: "unknown",
    sourceFixabilityClaim: "external_verification",
    scopeClaim: "execution_local",
    relatedIds: [],
  };
}

/**
 * M23 §19: maps an already-schema-validated `GenericCiV1` payload into the
 * internal `NormalizedEvidenceCandidate` transport DTO, applying Critical
 * rule 2's conservative reconciliation between the declared run status and
 * the aggregated per-check statuses. Never creates decision-escalation
 * candidates -- `generic-ci-json@1` is not permitted to (M23 §17).
 */
export function normalizeGenericCiV1(
  payload: GenericCiV1,
  sourcePayloadDigest: string,
): AdapterNormalizationResult {
  const mappedRunStatus = mapRunStatus(payload.run.status);
  const checksAggregate = computeChecksAggregate(payload.checks);
  const reconciled = reconcileCiStatus(mappedRunStatus, checksAggregate);

  const warnings: string[] = [];
  const sourceFindings: SourceFinding[] = [];
  const artifactReferences: ArtifactReference[] = [];

  for (const check of payload.checks) {
    for (const finding of check.findings ?? []) {
      sourceFindings.push(mapExternalFindingToSourceFinding(finding));
    }
    for (const artifact of check.artifacts ?? []) {
      artifactReferences.push(mapExternalArtifactToArtifactReference(artifact));
    }
  }

  if (mappedRunStatus !== checksAggregate) {
    warnings.push(
      `Run status and aggregated check status disagree (mappedRunStatus='${mappedRunStatus}', checksAggregate='${checksAggregate}'); continuing with the conservative reconciled result '${reconciled}'.`,
    );
    sourceFindings.push(buildDisagreementFinding(payload.run.status, mappedRunStatus, checksAggregate, reconciled));
  }

  const candidate: NormalizedEvidenceCandidate = {
    adapterId: GENERIC_CI_V1_ADAPTER_ID,
    sourcePayloadDigest,
    externalEvidenceId: payload.externalId ?? null,
    provider: {
      providerId: payload.source.providerId,
      providerType: "ci",
      trustLevel: GENERIC_CI_V1_TRUST_LEVEL,
    },
    workflowBinding: {
      workUnitId: payload.binding.workUnitId,
      packetId: payload.binding.packetId,
      checkpointId: payload.binding.checkpointId ?? null,
      implementationRootId: payload.binding.implementationRootId,
    },
    codeBinding: {
      branch: payload.binding.branch,
      commitSha: payload.binding.commitSha,
      repositoryFingerprint: payload.binding.repositoryFingerprint,
      workingTreeFingerprint: undefined,
      capturedAt: payload.run.completedAt,
    },
    reviewer: {
      reviewerId: undefined,
      reviewerType: "system",
      independentContext: "unknown",
    },
    results: {
      reviewResult: toReviewOutcome(reconciled),
      validationResult: toReviewOutcome(reconciled),
      acceptanceCriteriaResult: toAcceptanceOutcome(reconciled),
      summary: payload.run.summary,
    },
    sourceFindings,
    artifactReferences,
    decisionEscalationCandidates: [],
    capturedAt: payload.run.completedAt,
  };

  return { candidate, warnings };
}
