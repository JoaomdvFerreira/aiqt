import { z } from "zod";

/**
 * M45-WU01: the shared maintenance-schedule/occurrence contract. Contract
 * only -- due-time calculation, CLI mutation, and typed dispatch are added
 * by later Work Units on top of this owner. No parallel `.aiqt/schedules.*`
 * file or database exists anywhere; this section lives inside the
 * canonical `StateModel` (see `state.schema.ts`), mirroring M42-WU01's
 * `defects` precedent.
 *
 * A schedule is timing intent, never execution/approval authority (build
 * spec Sec 12): `policy.maxAutomaticRisk` may only lower the existing
 * remediation-risk automatic-approval ceiling (currently <50, see
 * remediation-risk.ts), never raise it -- enforced by this schema's bound
 * (max 49), not by caller discipline.
 */

export const MAX_MAINTENANCE_SCHEDULES = 200;

/** Section 5.1: the bounded, typed task registry -- never a free-form command string. */
export const MaintenanceTaskKindSchema = z.enum(["structural_review", "defect_discovery", "defect_remediation"]);
export type MaintenanceTaskKind = z.infer<typeof MaintenanceTaskKindSchema>;

/**
 * Section 7.3: bounded interval/cadence model, not arbitrary cron grammar.
 * Normalized to whole seconds for deterministic, UTC-based due calculation.
 * Bounds chosen to exclude both seconds-level high-frequency execution by
 * default (minimum 1 hour) and unbounded far-future cadence (maximum 30
 * days) -- CLI-facing durations ("1h"/"6h"/"1d"/"7d") normalize into this
 * one canonical representation (see maintenance-cadence.ts, WU45-02).
 */
export const MAINTENANCE_CADENCE_MIN_SECONDS = 3600; // 1h
export const MAINTENANCE_CADENCE_MAX_SECONDS = 30 * 24 * 3600; // 30d

export const MaintenanceScheduleCadenceSecondsSchema = z
  .number()
  .int()
  .min(MAINTENANCE_CADENCE_MIN_SECONDS)
  .max(MAINTENANCE_CADENCE_MAX_SECONDS);

/**
 * Section 7.2: task-kind-specific policy that may only restrict existing
 * authority. `maxAutomaticRisk` is capped at 49 in the schema itself (the
 * existing remediation-risk.ts human-approval boundary is `>= 50`) -- a
 * schedule can never widen that boundary, only lower it further.
 */
export const MaintenanceSchedulePolicySchema = z
  .object({
    maxAutomaticRisk: z.number().int().min(0).max(49).optional(),
  })
  .strict();
export type MaintenanceSchedulePolicy = z.infer<typeof MaintenanceSchedulePolicySchema>;

/** Section 16: the bounded outcome vocabulary for a finished occurrence, aligned with the existing CommandStatus contract plus `cancelled`. */
export const MaintenanceOccurrenceResultStatusSchema = z.enum(["passed", "warning", "failed", "blocked", "needs_input", "cancelled"]);
export type MaintenanceOccurrenceResultStatus = z.infer<typeof MaintenanceOccurrenceResultStatusSchema>;

/** Section 7.2: the durable, persistent schedule record. */
export const MaintenanceScheduleSchema = z
  .object({
    id: z.string().min(1),
    taskKind: MaintenanceTaskKindSchema,
    enabled: z.boolean(),
    cadenceSeconds: MaintenanceScheduleCadenceSecondsSchema,
    /** UTC ISO 8601. The fixed cadence-alignment point; due times are always anchorAt + n*cadenceSeconds. */
    anchorAt: z.string(),
    /** UTC ISO 8601. The next occurrence eligible for selection. */
    nextDueAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastOccurrenceAt: z.string().nullable(),
    lastOccurrenceId: z.string().nullable(),
    lastResultStatus: MaintenanceOccurrenceResultStatusSchema.nullable(),
    policy: MaintenanceSchedulePolicySchema,
  })
  .strict();
export type MaintenanceSchedule = z.infer<typeof MaintenanceScheduleSchema>;

/**
 * Section 8.3/13.2: the single active-occurrence slot -- deliberately a
 * nullable singleton, not an array, so "no parallel scheduled maintenance"
 * (build spec invariant 8) is a structural property of the state shape,
 * not a runtime check that could be bypassed. Cleared to null the moment
 * an occurrence finishes (success, failure, block, or cancellation);
 * completed-occurrence history lives in the runlog (Sec 15), never here.
 */
export const MaintenanceOccurrenceRecordSchema = z
  .object({
    occurrenceId: z.string().min(1),
    scheduleId: z.string().min(1),
    taskKind: MaintenanceTaskKindSchema,
    /** UTC ISO 8601 -- the cadence point this occurrence was selected for. */
    dueAt: z.string(),
    startedAt: z.string(),
    /** Section 9: how many prior due points were skipped (host offline) before this one. */
    missedOccurrenceCount: z.number().int().min(0),
  })
  .strict();
export type MaintenanceOccurrenceRecord = z.infer<typeof MaintenanceOccurrenceRecordSchema>;
