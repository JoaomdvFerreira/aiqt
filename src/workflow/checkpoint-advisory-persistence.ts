import type { StateModel } from "../schema/state.schema.js";
import { writeStateModel } from "../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildEvidenceGateAdvisoryObservationRecordedEvent,
  buildProjectIssueCreatedEvent,
  readRunlogEventIds,
  readRunlogEvents,
  type EvidenceGateAdvisoryObservationRecordedEventData,
} from "../state/runlog-store.js";
import { nextId } from "../state/ids.js";
import { upsertCheckpointAdvisory } from "./checkpoint-advisory-state.js";
import type { RunCheckpointAdvisoryResult } from "./checkpoint-advisory-integration.js";
import type { CheckpointAdvisoryObservation } from "../schema/checkpoint-evidence-advisory.schema.js";

export interface PersistCheckpointAdvisoryOutcome {
  kind: "created" | "no_op" | "repaired";
  /** True when a state write succeeded but the corresponding runlog append failed (M29 §3.1/§7.2: state remains authoritative; the gap is detectable and repairable via idempotent retry). */
  runlogGap: boolean;
}

function observationEventData(observation: CheckpointAdvisoryObservation): EvidenceGateAdvisoryObservationRecordedEventData {
  return {
    observationId: observation.observationId,
    checkpointId: observation.checkpointId,
    workUnitId: observation.workUnitId,
    trigger: observation.trigger,
    evaluationStatus: observation.evaluationStatus,
    overallResult: observation.overallResult,
    ...(observation.policyRef ? { policyRef: observation.policyRef } : {}),
    asOf: observation.asOf,
    ...(observation.simulationDigest ? { simulationDigest: observation.simulationDigest } : {}),
    issueKeys: observation.issueKeys,
    recordedAt: observation.recordedAt,
  };
}

function appendObservationEvent(runlogFile: string, timestamp: string, checkpointId: string, workUnitId: string, observation: CheckpointAdvisoryObservation): void {
  const eventIds = readRunlogEventIds(runlogFile);
  appendRunlogEvent(
    runlogFile,
    buildEvidenceGateAdvisoryObservationRecordedEvent({
      id: nextId("EVT", eventIds),
      timestamp,
      relatedIds: [checkpointId, workUnitId],
      data: observationEventData(observation),
    }),
  );
}

/**
 * M29 §3.1/§4: the single persistence path shared by automatic checkpoint
 * evaluation, amendment-triggered refresh, and explicit refresh -- one
 * state write covering both the advisory overlay and any newly-created
 * advisory-sourced ProjectIssues, followed by the required runlog events.
 * On a "no_op" (identical observation already current), the runlog is
 * still checked for the matching event and backfilled if a prior write
 * left a gap (M29 §3.1: "retry appends the missing event without
 * duplicating state" / requirement #19's idempotent event repair). Throws
 * only on the (structurally near-impossible) identity conflict case;
 * callers decide how to surface that.
 */
export function persistCheckpointAdvisoryResult(params: {
  stateFile: string;
  runlogFile: string;
  state: StateModel;
  result: RunCheckpointAdvisoryResult;
  timestamp: string;
  checkpointId: string;
  workUnitId: string;
}): PersistCheckpointAdvisoryOutcome {
  const { result } = params;

  if (result.applyOutcome.kind === "conflict") {
    throw new Error("Advisory observation identity conflict (unexpected non-deterministic evaluation).");
  }

  if (result.applyOutcome.kind === "no_op") {
    const matched = result.applyOutcome.matched;
    const alreadyInRunlog = readRunlogEvents(params.runlogFile).some(
      (e) => e.type === "evidence_gate.advisory_observation_recorded" && (e.data as { observationId?: unknown } | undefined)?.observationId === matched.observationId,
    );
    if (alreadyInRunlog) {
      return { kind: "no_op", runlogGap: false };
    }
    let runlogGap = false;
    try {
      appendObservationEvent(params.runlogFile, params.timestamp, params.checkpointId, params.workUnitId, matched);
    } catch {
      runlogGap = true;
    }
    return { kind: runlogGap ? "no_op" : "repaired", runlogGap };
  }

  const existingIssues = params.state.issues;
  const finalState: StateModel = {
    ...params.state,
    checkpointEvidenceAdvisories: upsertCheckpointAdvisory(
      params.state.checkpointEvidenceAdvisories ?? [],
      result.applyOutcome.advisory,
    ),
    ...(result.createdProjectIssues.length > 0
      ? {
          issues: {
            overrides: existingIssues?.overrides ?? [],
            promotions: existingIssues?.promotions ?? [],
            projectIssues: [...(existingIssues?.projectIssues ?? []), ...result.createdProjectIssues],
            ...(existingIssues?.projectIssueTransitions ? { projectIssueTransitions: existingIssues.projectIssueTransitions } : {}),
          },
        }
      : {}),
  };
  writeStateModel(params.stateFile, finalState);

  let runlogGap = false;
  try {
    appendObservationEvent(params.runlogFile, params.timestamp, params.checkpointId, params.workUnitId, result.observation);

    for (const created of result.createdProjectIssues) {
      const eventIds = readRunlogEventIds(params.runlogFile);
      appendRunlogEvent(
        params.runlogFile,
        buildProjectIssueCreatedEvent({
          id: nextId("EVT", eventIds),
          timestamp: params.timestamp,
          relatedIds: [created.projectIssueId, params.checkpointId],
          data: {
            projectIssueId: created.projectIssueId,
            issueKey: created.issueKey,
            severity: created.severity,
            sourceType: created.sourceType,
          },
        }),
      );
    }
  } catch {
    runlogGap = true;
  }

  return { kind: "created", runlogGap };
}
