import type { StateModel } from "../schema/state.schema.js";
import type { EvidenceRecord, EvidenceBindingStatus } from "../schema/evidence.schema.js";
import type { DecisionEscalation } from "../schema/decision-escalation.schema.js";
import type { ProjectIssue, ProjectIssueTransition } from "../schema/project-issue.schema.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";
import type { NormalizedEvidenceCandidate } from "../schema/external-evidence/normalized-evidence-candidate.js";

import { nextId } from "../state/ids.js";
import { getEvidenceRecords, buildRecordEvidenceCandidate } from "../services/evidence-service.js";
import { getProjectIssues, getProjectIssueTransitions, findProjectIssueByKey } from "../services/project-issue-service.js";
import { findCheckpointIssueByKey, checkpointIssueKey } from "../services/issue-service.js";
import { mintEvidenceIssueKey, mintDecisionEscalationKey } from "../workflow/finding-fingerprint.js";
import {
  applyCheckpointToProjectIssueTransition,
  resolveOrCreateProjectIssue,
  type ProjectIssueSeedFields,
} from "../workflow/finding-routing.js";
import {
  buildDecisionEscalationCreatedEvent,
  buildProjectIssueCreatedEvent,
  buildProjectIssueTransitionedEvent,
} from "../state/runlog-store.js";

/** M23-WU02 §16: EvidenceRecordSchema.contractVersion requires `major.minor`; M22 never defined a canonical constant, so M23 fixes its own. */
const IMPORTED_EVIDENCE_CONTRACT_VERSION = "1.0";

/**
 * M23 §14 (binding behavior): current -> accept silently; stale/
 * unavailable/unknown -> accept with a bounded warning; mismatched ->
 * reject outright with zero mutation. Never rewrites binding fields to
 * force a match.
 */
export type ImportBindingDecision =
  | { accepted: true; warning: string | null }
  | { accepted: false; reason: string };

export function evaluateImportBindingDecision(status: EvidenceBindingStatus): ImportBindingDecision {
  switch (status) {
    case "current":
      return { accepted: true, warning: null };
    case "stale":
      return { accepted: true, warning: "Evidence binding is stale relative to the current workflow/code state." };
    case "unavailable":
      return {
        accepted: true,
        warning: "Current workflow/code state could not be inspected; binding could not be verified.",
      };
    case "unknown":
      return {
        accepted: true,
        warning: "Evidence binding could not be determined (no comparable code-state facts on one or both sides).",
      };
    case "mismatched":
      return {
        accepted: false,
        reason:
          "Evidence binding does not match the current workflow/code state (workUnitId/packetId/implementationRootId mismatch).",
      };
  }
}

export type ImportIdentityOutcome = "create" | "no_op" | "conflict";

export interface ImportIdentityResolution {
  outcome: ImportIdentityOutcome;
  existingEvidenceId?: string;
  reason?: string;
}

/**
 * M23 §9 Critical rule 1 conflict matrix: no existing record with this
 * `importIdentityKey` -> create; an existing record with the same key AND
 * the same `sourcePayloadDigest` -> no_op (link_existing, idempotent
 * replay); an existing record with the same key but a DIFFERENT digest ->
 * conflict (reject, zero mutation). Historical evidence is never
 * overwritten.
 */
export function resolveImportConflict(
  importIdentityKey: string,
  sourcePayloadDigest: string,
  existingRecords: readonly EvidenceRecord[],
): ImportIdentityResolution {
  const match = existingRecords.find((r) => r.importProvenance?.importIdentityKey === importIdentityKey);
  if (!match) {
    return { outcome: "create" };
  }
  if (match.importProvenance?.sourcePayloadDigest === sourcePayloadDigest) {
    return { outcome: "no_op", existingEvidenceId: match.evidenceId };
  }
  return {
    outcome: "conflict",
    existingEvidenceId: match.evidenceId,
    reason: `importIdentityKey '${importIdentityKey}' already resolves to evidence '${match.evidenceId}' with a different payload digest -- refusing to overwrite historical evidence.`,
  };
}

export interface BuildEvidenceImportCandidateParams {
  state: StateModel;
  candidate: NormalizedEvidenceCandidate;
  importIdentityKey: string;
  bindingStatus: EvidenceBindingStatus;
  timestamp: string;
  adapterWarnings: readonly string[];
  /** Deterministic event-ID allocator -- the caller owns runlog event ID sequencing. */
  nextEventId: () => string;
}

export interface EvidenceImportCandidateSuccess {
  ok: true;
  changed: boolean;
  outcome: "created" | "no_op";
  evidenceRecord: EvidenceRecord;
  createdDecisionEscalations: DecisionEscalation[];
  linkedDecisionEscalationIds: string[];
  createdProjectIssues: ProjectIssue[];
  linkedProjectIssueKeys: string[];
  projectIssueTransitions: ProjectIssueTransition[];
  runlogEvents: RunlogEvent[];
  warnings: string[];
}

export interface EvidenceImportCandidateFailure {
  ok: false;
  error: string;
}

export type EvidenceImportCandidateResult = EvidenceImportCandidateSuccess | EvidenceImportCandidateFailure;

/**
 * M23 §15 (atomic mutation) / §19 (M22 integration): the single pure
 * candidate-state builder used identically by both preview and mutation
 * (structural parity by construction -- there is no second code path).
 * Reuses M22's binding evaluator's output, `buildRecordEvidenceCandidate`,
 * `applyCheckpointToProjectIssueTransition`, `findProjectIssueByKey`, and
 * the M23-WU06 additive `resolveOrCreateProjectIssue`/
 * `findCheckpointIssueByKey` extensions of those same M22-owned modules.
 * Never persists anything -- the caller is responsible for
 * `writeStateModel`/`appendRunlogEvent` using the established atomic-write
 * sequence, only after this function returns `ok: true`.
 */
export function buildEvidenceImportCandidate(
  params: BuildEvidenceImportCandidateParams,
): EvidenceImportCandidateResult {
  const { state, candidate, importIdentityKey, bindingStatus, timestamp } = params;

  const bindingDecision = evaluateImportBindingDecision(bindingStatus);
  if (!bindingDecision.accepted) {
    return { ok: false, error: bindingDecision.reason };
  }
  const warnings: string[] = [...params.adapterWarnings];
  if (bindingDecision.warning) warnings.push(bindingDecision.warning);

  const existingRecords = getEvidenceRecords(state);
  const identity = resolveImportConflict(importIdentityKey, candidate.sourcePayloadDigest, existingRecords);

  if (identity.outcome === "conflict") {
    return { ok: false, error: identity.reason as string };
  }

  if (identity.outcome === "no_op") {
    const existing = existingRecords.find((r) => r.evidenceId === identity.existingEvidenceId);
    if (!existing) {
      return { ok: false, error: `Import identity resolved to an evidence record that could not be found: ${identity.existingEvidenceId}` };
    }
    return {
      ok: true,
      changed: false,
      outcome: "no_op",
      evidenceRecord: existing,
      createdDecisionEscalations: [],
      linkedDecisionEscalationIds: [...existing.decisionEscalationIds],
      createdProjectIssues: [],
      linkedProjectIssueKeys: [],
      projectIssueTransitions: [],
      runlogEvents: [],
      warnings,
    };
  }

  const runlogEvents: RunlogEvent[] = [];
  const evidenceId = nextId("EVID", existingRecords.map((r) => r.evidenceId));

  const existingEscalations = state.evidence?.decisionEscalations ?? [];
  let workingEscalations = [...existingEscalations];
  const createdDecisionEscalations: DecisionEscalation[] = [];
  const linkedDecisionEscalationIds: string[] = [];

  for (const proposal of candidate.decisionEscalationCandidates) {
    const escalationKey = mintDecisionEscalationKey(proposal.category, proposal.question, 0);
    const existingMatch = workingEscalations.find((e) => e.escalationKey === escalationKey);
    if (existingMatch) {
      linkedDecisionEscalationIds.push(existingMatch.escalationId);
      continue;
    }
    const escalationId = nextId("DE", workingEscalations.map((e) => e.escalationId));
    const newEscalation: DecisionEscalation = {
      escalationId,
      escalationKey,
      category: proposal.category,
      status: "open",
      question: proposal.question,
      rationale: proposal.rationale,
      relatedWorkUnitIds: [candidate.workflowBinding.workUnitId],
      relatedMilestoneIds: [],
      evidenceIds: [evidenceId],
      resolution: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    workingEscalations = [...workingEscalations, newEscalation];
    createdDecisionEscalations.push(newEscalation);
    runlogEvents.push(
      buildDecisionEscalationCreatedEvent({
        id: params.nextEventId(),
        timestamp,
        relatedIds: [newEscalation.escalationId],
        data: {
          escalationId: newEscalation.escalationId,
          escalationKey: newEscalation.escalationKey,
          category: newEscalation.category,
        },
      }),
    );
  }

  const evidenceRecord: EvidenceRecord = {
    evidenceId,
    contractVersion: IMPORTED_EVIDENCE_CONTRACT_VERSION,
    provider: candidate.provider,
    workflowBinding: {
      workUnitId: candidate.workflowBinding.workUnitId,
      packetId: candidate.workflowBinding.packetId,
      checkpointId: candidate.workflowBinding.checkpointId ?? undefined,
      implementationRootId: candidate.workflowBinding.implementationRootId,
    },
    codeBinding: {
      branch: candidate.codeBinding.branch,
      commitSha: candidate.codeBinding.commitSha,
      repositoryFingerprint: candidate.codeBinding.repositoryFingerprint,
      workingTreeFingerprint: candidate.codeBinding.workingTreeFingerprint,
      capturedAt: candidate.codeBinding.capturedAt,
    },
    reviewer: candidate.reviewer,
    results: candidate.results,
    sourceFindings: candidate.sourceFindings,
    decisionEscalationIds: [...linkedDecisionEscalationIds, ...createdDecisionEscalations.map((e) => e.escalationId)],
    artifactReferences: candidate.artifactReferences,
    recordedAt: timestamp,
    importProvenance: {
      adapterId: candidate.adapterId,
      sourcePayloadDigest: candidate.sourcePayloadDigest,
      externalEvidenceId: candidate.externalEvidenceId ?? undefined,
      importIdentityKey,
      importedAt: timestamp,
    },
  };

  const tempStateForEvidence: StateModel = {
    ...state,
    evidence: { records: existingRecords, decisionEscalations: workingEscalations },
  };
  const evidenceResult = buildRecordEvidenceCandidate({
    state: tempStateForEvidence,
    evidence: evidenceRecord,
    timestamp,
    eventId: params.nextEventId(),
  });
  if (!evidenceResult.ok) {
    return { ok: false, error: evidenceResult.error };
  }
  if (evidenceResult.runlogEvent) {
    runlogEvents.push(evidenceResult.runlogEvent);
  }

  let workingProjectIssues = getProjectIssues(state);
  let workingTransitions = getProjectIssueTransitions(state);
  const createdProjectIssues: ProjectIssue[] = [];
  const linkedProjectIssueKeys: string[] = [];
  const projectIssueTransitions: ProjectIssueTransition[] = [];

  for (const finding of candidate.sourceFindings) {
    // M22's CheckpointIssue and ProjectIssue-from-evidence keys use distinct
    // schemes (`checkpoint:<workUnitId>:issue:<slug>` vs
    // `evidence:<scopeClaim>:<slug>`) -- a finding can only correspond to an
    // *existing* CheckpointIssue if it resolves under the checkpoint scheme,
    // so that lookup must run first, using that scheme's own key.
    const checkpointCandidateKey = checkpointIssueKey(candidate.workflowBinding.workUnitId, finding.title, 0);

    if (findProjectIssueByKey(checkpointCandidateKey, workingProjectIssues)) {
      linkedProjectIssueKeys.push(checkpointCandidateKey);
      continue;
    }

    const checkpointMatch = findCheckpointIssueByKey(state, checkpointCandidateKey);
    if (checkpointMatch) {
      const issueKey = checkpointCandidateKey;
      const transitionResult = applyCheckpointToProjectIssueTransition({
        issueKey,
        checkpointId: checkpointMatch.checkpoint.id,
        checkpointIssueRef: checkpointMatch.issue.title,
        reason: "project_tracking_required",
        evidenceIds: [evidenceId],
        existingProjectIssues: workingProjectIssues,
        existingTransitions: workingTransitions,
        timestamp,
        nextProjectIssueId: nextId("PI", workingProjectIssues.map((pi) => pi.projectIssueId)),
        nextTransitionId: nextId("PIT", workingTransitions.map((t) => t.transitionId)),
        projectIssueSeedFields: buildCheckpointSeedFields(checkpointMatch, evidenceId),
      });

      if (!transitionResult.changed) {
        linkedProjectIssueKeys.push(issueKey);
        continue;
      }

      workingProjectIssues = [...workingProjectIssues, transitionResult.projectIssue];
      createdProjectIssues.push(transitionResult.projectIssue);
      if (transitionResult.transition) {
        workingTransitions = [...workingTransitions, transitionResult.transition];
        projectIssueTransitions.push(transitionResult.transition);
        runlogEvents.push(
          buildProjectIssueTransitionedEvent({
            id: params.nextEventId(),
            timestamp,
            relatedIds: [transitionResult.transition.transitionId, transitionResult.projectIssue.projectIssueId],
            data: {
              transitionId: transitionResult.transition.transitionId,
              issueKey,
              projectIssueId: transitionResult.projectIssue.projectIssueId,
              checkpointId: checkpointMatch.checkpoint.id,
              reason: "project_tracking_required",
            },
          }),
        );
      }
      continue;
    }

    // No corresponding CheckpointIssue exists (or none was ever created) --
    // fall back to the evidence-owned key scheme for a standalone
    // ProjectIssue with no checkpoint origin.
    const evidenceIssueKey = mintEvidenceIssueKey(finding.scopeClaim, finding.title, 0);
    const created = resolveOrCreateProjectIssue({
      issueKey: evidenceIssueKey,
      existingProjectIssues: workingProjectIssues,
      nextProjectIssueId: nextId("PI", workingProjectIssues.map((pi) => pi.projectIssueId)),
      timestamp,
      projectIssueSeedFields: buildFindingSeedFields(candidate, finding, evidenceId),
    });

    if (!created.changed) {
      linkedProjectIssueKeys.push(evidenceIssueKey);
      continue;
    }
    workingProjectIssues = [...workingProjectIssues, created.projectIssue];
    createdProjectIssues.push(created.projectIssue);
    runlogEvents.push(
      buildProjectIssueCreatedEvent({
        id: params.nextEventId(),
        timestamp,
        relatedIds: [created.projectIssue.projectIssueId],
        data: {
          projectIssueId: created.projectIssue.projectIssueId,
          issueKey: evidenceIssueKey,
          severity: created.projectIssue.severity,
          sourceType: created.projectIssue.sourceType,
        },
      }),
    );
  }

  return {
    ok: true,
    changed: true,
    outcome: "created",
    evidenceRecord,
    createdDecisionEscalations,
    linkedDecisionEscalationIds,
    createdProjectIssues,
    linkedProjectIssueKeys,
    projectIssueTransitions,
    runlogEvents,
    warnings,
  };
}

/**
 * M23 §6.5/§17: canonical severity is never derived from an untrusted
 * external severity claim. Evidence-sourced ProjectIssues always seed with
 * a fixed, conservative "medium" severity; any real severity determination
 * remains a human/agent responsibility exercised through the existing
 * IssueOverride mechanism (M11), not this import path.
 */
function buildFindingSeedFields(
  candidate: NormalizedEvidenceCandidate,
  finding: NormalizedEvidenceCandidate["sourceFindings"][number],
  evidenceId: string,
): ProjectIssueSeedFields {
  return {
    title: finding.title,
    description: finding.summary,
    severity: "medium",
    sourceType: "evidence",
    sourceRefs: [evidenceId],
    affectedWorkUnitIds: [candidate.workflowBinding.workUnitId],
    affectedMilestoneIds: [],
    evidenceIds: [evidenceId],
    checkpointRefs: [],
    ownerRef: null,
    promotionRefs: [],
  };
}

/** M23 §19: when promoting an existing (immutable) CheckpointIssue via a transition, the transition's ProjectIssue is seeded from that checkpoint issue's own canonical fields, never from the untrusted import claim. */
function buildCheckpointSeedFields(
  match: NonNullable<ReturnType<typeof findCheckpointIssueByKey>>,
  evidenceId: string,
): ProjectIssueSeedFields {
  return {
    title: match.issue.title,
    description: match.issue.description ?? match.issue.title,
    severity: match.issue.severity,
    sourceType: "checkpoint",
    sourceRefs: [match.checkpoint.id],
    affectedWorkUnitIds: [match.checkpoint.workUnitId],
    affectedMilestoneIds: [],
    evidenceIds: [evidenceId],
    checkpointRefs: [match.checkpoint.id],
    ownerRef: null,
    promotionRefs: [],
  };
}
