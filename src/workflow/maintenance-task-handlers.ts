import { resolve } from "node:path";
import type { StateModel } from "../schema/state.schema.js";
import type { MaintenanceOccurrenceResultStatus, MaintenanceSchedule } from "../schema/maintenance-schedule.schema.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";
import { runStructuralReview } from "./structural-review-engine.js";
import { consolidateFindings, suppressKnownBenignFindings } from "./structural-review-consolidation.js";
import { discoverFromCheckpoints } from "./defect-discovery.js";
import { applyDiscoveryCandidates } from "../services/defect-discovery-service.js";
import { buildDefectCandidateDiscoveredEvent } from "../state/runlog-store.js";

/**
 * M45-WU03 (build spec Sec 11): typed internal handlers, one per
 * MaintenanceTaskKind -- never a shell command string. Each handler is a
 * pure function of (cwd, state, schedule, now); the caller (maintenance-
 * run-service.ts) performs the actual write + runlog append. No handler
 * here ever mutates the filesystem or the runlog directly.
 */

export interface MaintenanceTaskContext {
  cwd: string;
  state: StateModel;
  schedule: MaintenanceSchedule;
  now: string;
  /** Same sequential EVT-id allocator the caller uses for its own wrapping events (execution-runlog-event-builder.ts's nextEventIdFactory) -- handlers never invent their own id scheme. */
  allocateEventId: () => string;
}

export interface MaintenanceTaskResult {
  resultStatus: MaintenanceOccurrenceResultStatus;
  summary: string;
  /** Full replacement state; identical to `ctx.state` for a read-only task. */
  nextState: StateModel;
  /** Runlog events the handler wants appended, IN ADDITION TO the wrapping run_started/run_completed events the caller always appends. */
  additionalRunlogEvents: RunlogEvent[];
  data: Record<string, unknown>;
}

/**
 * Build spec Sec 5.1: reuses the M43 structural-review engine verbatim,
 * exactly as `aiqt review structural` does -- read-only, no mutation, no
 * Graphify requirement (optional-provider status is not queried here;
 * that remains `aiqt review structural`'s own concern). Findings are
 * never auto-intaken into the M42 defect queue -- only counts/keys are
 * recorded as occurrence evidence (build spec Sec 5.1: "result evidence
 * may record counts/keys/digests, but findings remain subject to
 * M43/M42 intake boundaries").
 */
export function runStructuralReviewTask(ctx: MaintenanceTaskContext): MaintenanceTaskResult {
  const repoRoot = resolve(ctx.cwd);
  const raw = runStructuralReview({ repoRoot });
  const findings = suppressKnownBenignFindings(consolidateFindings(raw.findings));
  const actionable = findings.filter((f) => f.disposition === "actionable").length;

  return {
    resultStatus: "passed",
    summary: `Structural review: ${findings.length} finding(s) (${actionable} actionable), read-only -- no defects were created.`,
    nextState: ctx.state,
    additionalRunlogEvents: [],
    data: {
      reviewCommit: raw.reviewCommit,
      findingCount: findings.length,
      actionableFindingCount: actionable,
      findingKeys: findings.map((f) => f.findingKey),
      domainsSupported: raw.domainsSupported,
      domainsUnsupported: raw.domainsUnsupported,
    },
  };
}

/**
 * Build spec Sec 5.1: reuses M42's discoverFromCheckpoints/
 * applyDiscoveryCandidates verbatim -- the same functions `aiqt defects
 * discover` calls, bounded to state.checkpoints (no external evidence
 * required, so this is safe to run unattended). Discovery alone never
 * authorizes remediation (M42's core invariant, unchanged here): every
 * created/enriched record starts/stays at whatever status it already had.
 */
export function runDefectDiscoveryTask(ctx: MaintenanceTaskContext): MaintenanceTaskResult {
  const candidates = discoverFromCheckpoints(ctx.state, ctx.now);
  if (candidates.length === 0) {
    return {
      resultStatus: "passed",
      summary: "Defect discovery: no bounded checkpoint evidence found.",
      nextState: ctx.state,
      additionalRunlogEvents: [],
      data: { created: [], enriched: [] },
    };
  }

  const existingDefects = ctx.state.defects ?? [];
  const result = applyDiscoveryCandidates(existingDefects, candidates, ctx.now);
  const nextState: StateModel = { ...ctx.state, defects: result.defects };

  const additionalRunlogEvents: RunlogEvent[] = [];
  for (const c of result.created) {
    additionalRunlogEvents.push(
      buildDefectCandidateDiscoveredEvent({
        id: ctx.allocateEventId(),
        timestamp: ctx.now,
        relatedIds: [c.defectId],
        data: { defectId: c.defectId, sourceKind: c.sourceKind, fingerprint: c.fingerprint, outcome: "created" },
      }),
    );
  }
  for (const e of result.enriched) {
    additionalRunlogEvents.push(
      buildDefectCandidateDiscoveredEvent({
        id: ctx.allocateEventId(),
        timestamp: ctx.now,
        relatedIds: [e.defectId],
        data: { defectId: e.defectId, sourceKind: "failed_validation", fingerprint: e.fingerprint, outcome: "enriched" },
      }),
    );
  }

  return {
    resultStatus: "passed",
    summary: `Defect discovery: created ${result.created.length}, enriched ${result.enriched.length}${result.skippedAtCap.length > 0 ? `, ${result.skippedAtCap.length} skipped at cap` : ""}. Remediation was not authorized.`,
    nextState,
    additionalRunlogEvents,
    data: { created: result.created.map((c) => c.defectId), enriched: result.enriched.map((e) => e.defectId), skippedAtCap: result.skippedAtCap.length },
  };
}
