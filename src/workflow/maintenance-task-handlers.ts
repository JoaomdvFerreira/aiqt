import { resolve } from "node:path";
import type { StateModel } from "../schema/state.schema.js";
import type { MaintenanceOccurrenceResultStatus, MaintenanceSchedule } from "../schema/maintenance-schedule.schema.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";
import { runStructuralReview } from "./structural-review-engine.js";
import { consolidateFindings, suppressKnownBenignFindings } from "./structural-review-consolidation.js";
import { discoverFromCheckpoints } from "./defect-discovery.js";
import { applyDiscoveryCandidates } from "../services/defect-discovery-service.js";
import { buildDefectCandidateDiscoveredEvent } from "../state/runlog-store.js";
import { sortByQueuePriority } from "./defect-triage.js";
import { computeRemediationRisk } from "./remediation-risk.js";
import { prepareRemediation } from "../services/defect-remediation-service.js";
import { nextId } from "../state/ids.js";

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

const REMEDIATION_ACCEPTANCE_CONTRACT =
  'Validation evidence must be recorded via "aiqt defects record-validation" before this remediation is considered resolved. Scheduled remediation only prepares the decision -- it never records validation on its own.';

/**
 * Build spec Sec 5.1/12/WU45-04: selects at most one eligible (`queued`)
 * defect via M42's own deterministic queue ordering (sortByQueuePriority),
 * and calls prepareRemediation -- the exact function `aiqt defects
 * remediate` calls -- with no `approvedBy` (this is an unattended
 * occurrence). Deliberately does NOT bridge to live M36-M39 sandboxed
 * execution (see the maintenanceScheduling owner-map entry for the full
 * reasoning): a schedule may only ever produce the same bounded
 * external-agent handoff/request M42 already produces, never execute
 * code. The schedule's own `policy.maxAutomaticRisk` (schema-bounded to
 * <=49) is checked BEFORE calling prepareRemediation, so it can narrow
 * the automation window below the global <50 boundary but never widen it
 * past 50 -- prepareRemediation's own internal >=50 human-approval gate
 * remains the final, unconditional backstop either way.
 */
export function runDefectRemediationTask(ctx: MaintenanceTaskContext): MaintenanceTaskResult {
  const defects = ctx.state.defects ?? [];
  const queued = defects.filter((d) => d.status === "queued");

  if (queued.length === 0) {
    return {
      resultStatus: "passed",
      summary: "Defect remediation: no eligible queued defect.",
      nextState: ctx.state,
      additionalRunlogEvents: [],
      data: { selectedDefectId: null },
    };
  }

  const selected = sortByQueuePriority(queued)[0];
  const scope = selected.affectedFiles ?? [];
  const risk = computeRemediationRisk({ scope, affectedWorkUnitId: selected.affectedWorkUnitId });
  const automaticCeiling = ctx.schedule.policy.maxAutomaticRisk ?? 49;

  if (risk.score > automaticCeiling) {
    return {
      resultStatus: "needs_input",
      summary: `Defect remediation: "${selected.defectId}" remediation risk ${risk.score}/100 (${risk.band}) exceeds the automatic ceiling of ${automaticCeiling}; human approval is required. No state was changed.`,
      nextState: ctx.state,
      additionalRunlogEvents: [],
      data: { selectedDefectId: selected.defectId, riskScore: risk.score, riskBand: risk.band, automaticCeiling, requiresHumanApproval: true },
    };
  }

  const remediationId = nextId(
    "REM",
    defects.map((d) => d.remediation?.remediationId).filter((id): id is string => Boolean(id)),
  );
  const outcome = prepareRemediation({
    defect: selected,
    remediationId,
    objective: `Scheduled remediation of ${selected.defectId}: ${selected.title}`,
    scope: [...scope],
    outOfScope: [],
    acceptanceContract: REMEDIATION_ACCEPTANCE_CONTRACT,
    now: ctx.now,
  });

  if (!outcome.ok) {
    return {
      resultStatus: "blocked",
      summary: `Defect remediation: ${outcome.reason}`,
      nextState: ctx.state,
      additionalRunlogEvents: [],
      data: { selectedDefectId: selected.defectId, riskScore: risk.score, riskBand: risk.band },
    };
  }

  const nextDefects = defects.map((d) => (d.defectId === selected.defectId ? outcome.defect : d));
  return {
    resultStatus: "passed",
    summary: `Defect remediation: prepared ${remediationId} for ${selected.defectId} (risk ${risk.score}/100, ${risk.band}); status now "in_progress". Validation must still be recorded separately.`,
    nextState: { ...ctx.state, defects: nextDefects },
    additionalRunlogEvents: [],
    data: { selectedDefectId: selected.defectId, remediationId, riskScore: risk.score, riskBand: risk.band },
  };
}
