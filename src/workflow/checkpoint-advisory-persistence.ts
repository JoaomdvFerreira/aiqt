import type { StateModel } from "../schema/state.schema.js";
import { writeStateModel } from "../state/workflow-state-store.js";
import { appendRunlogEvent, buildEvidenceGateAdvisoryObservationRecordedEvent, buildProjectIssueCreatedEvent, readRunlogEventIds } from "../state/runlog-store.js";
import { nextId } from "../state/ids.js";
import { upsertCheckpointAdvisory } from "./checkpoint-advisory-state.js";
import type { RunCheckpointAdvisoryResult } from "./checkpoint-advisory-integration.js";

export interface PersistCheckpointAdvisoryOutcome {
  kind: "created" | "no_op";
  /** True when the state write succeeded but at least one runlog append failed (M29 §3.1/§7.2: state remains authoritative; the gap is detectable and repairable via idempotent retry). */
  runlogGap: boolean;
}

/**
 * M29 §3.1/§4: the single persistence path shared by automatic checkpoint
 * evaluation and explicit refresh -- one state write covering both the
 * advisory overlay and any newly-created advisory-sourced ProjectIssues,
 * followed by the required runlog events. Throws only on the (structurally
 * near-impossible) identity conflict case; callers decide how to surface
 * that.
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
    return { kind: "no_op", runlogGap: false };
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
    const eventIds = readRunlogEventIds(params.runlogFile);
    let nextEventId = nextId("EVT", eventIds);
    let usedIds = [...eventIds, nextEventId];

    appendRunlogEvent(
      params.runlogFile,
      buildEvidenceGateAdvisoryObservationRecordedEvent({
        id: nextEventId,
        timestamp: params.timestamp,
        relatedIds: [params.checkpointId, params.workUnitId],
        data: {
          observationId: result.observation.observationId,
          checkpointId: result.observation.checkpointId,
          workUnitId: result.observation.workUnitId,
          trigger: result.observation.trigger,
          evaluationStatus: result.observation.evaluationStatus,
          overallResult: result.observation.overallResult,
          ...(result.observation.policyRef ? { policyRef: result.observation.policyRef } : {}),
          asOf: result.observation.asOf,
          ...(result.observation.simulationDigest ? { simulationDigest: result.observation.simulationDigest } : {}),
          issueKeys: result.observation.issueKeys,
          recordedAt: result.observation.recordedAt,
        },
      }),
    );

    for (const created of result.createdProjectIssues) {
      nextEventId = nextId("EVT", usedIds);
      usedIds = [...usedIds, nextEventId];
      appendRunlogEvent(
        params.runlogFile,
        buildProjectIssueCreatedEvent({
          id: nextEventId,
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
