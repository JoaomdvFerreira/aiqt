import { describe, it, expect } from "vitest";
import {
  MaintenanceScheduleSchema,
  MaintenanceSchedulePolicySchema,
  MaintenanceOccurrenceRecordSchema,
  MAINTENANCE_CADENCE_MIN_SECONDS,
  MAINTENANCE_CADENCE_MAX_SECONDS,
} from "../../src/schema/maintenance-schedule.schema.js";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const NOW = "2026-08-08T00:00:00.000Z";

function buildSchedule(overrides: Partial<Parameters<typeof MaintenanceScheduleSchema.parse>[0]> = {}) {
  return MaintenanceScheduleSchema.parse({
    id: "SCHED-001",
    taskKind: "structural_review",
    enabled: true,
    cadenceSeconds: 86400,
    anchorAt: NOW,
    nextDueAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    lastOccurrenceAt: null,
    lastOccurrenceId: null,
    lastResultStatus: null,
    policy: {},
    ...overrides,
  });
}

describe("MaintenanceSchedulePolicySchema (build spec Sec 7.2/12)", () => {
  it("accepts a maxAutomaticRisk at or below the existing 49-max automatic ceiling", () => {
    expect(MaintenanceSchedulePolicySchema.safeParse({ maxAutomaticRisk: 35 }).success).toBe(true);
    expect(MaintenanceSchedulePolicySchema.safeParse({ maxAutomaticRisk: 49 }).success).toBe(true);
    expect(MaintenanceSchedulePolicySchema.safeParse({}).success).toBe(true);
  });

  it("rejects a maxAutomaticRisk at or above the global human-approval boundary (50) -- policy can never widen authority", () => {
    expect(MaintenanceSchedulePolicySchema.safeParse({ maxAutomaticRisk: 50 }).success).toBe(false);
    expect(MaintenanceSchedulePolicySchema.safeParse({ maxAutomaticRisk: 60 }).success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(MaintenanceSchedulePolicySchema.safeParse({ maxAutomaticRisk: 10, extra: "nope" }).success).toBe(false);
  });
});

describe("MaintenanceScheduleSchema cadence bounds (build spec Sec 7.3)", () => {
  it("accepts cadence at the documented min/max bounds", () => {
    expect(() => buildSchedule({ cadenceSeconds: MAINTENANCE_CADENCE_MIN_SECONDS })).not.toThrow();
    expect(() => buildSchedule({ cadenceSeconds: MAINTENANCE_CADENCE_MAX_SECONDS })).not.toThrow();
  });

  it("rejects sub-minimum (seconds-level high-frequency) and above-maximum cadence", () => {
    expect(MaintenanceScheduleSchema.safeParse({ ...buildSchedule(), cadenceSeconds: 60 }).success).toBe(false);
    expect(MaintenanceScheduleSchema.safeParse({ ...buildSchedule(), cadenceSeconds: MAINTENANCE_CADENCE_MAX_SECONDS + 1 }).success).toBe(false);
  });

  it("round-trips a minimal valid schedule record", () => {
    const parsed = MaintenanceScheduleSchema.safeParse(buildSchedule());
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const raw = { ...buildSchedule(), extraField: "nope" };
    expect(MaintenanceScheduleSchema.safeParse(raw).success).toBe(false);
  });
});

describe("MaintenanceOccurrenceRecordSchema", () => {
  it("round-trips a minimal valid occurrence record", () => {
    const parsed = MaintenanceOccurrenceRecordSchema.safeParse({
      occurrenceId: "sha256:" + "a".repeat(64),
      scheduleId: "SCHED-001",
      taskKind: "structural_review",
      dueAt: NOW,
      startedAt: NOW,
      missedOccurrenceCount: 0,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("StateModel.maintenanceSchedules / maintenanceActiveOccurrence (M45 additive canonical section)", () => {
  it("is absent on a freshly built initial state model and still validates", () => {
    const model = buildInitialStateModel(NOW);
    expect((model as Record<string, unknown>).maintenanceSchedules).toBeUndefined();
    expect((model as Record<string, unknown>).maintenanceActiveOccurrence).toBeUndefined();
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });

  it("validates when maintenanceSchedules is present and populated, and maintenanceActiveOccurrence is null", () => {
    const model = { ...buildInitialStateModel(NOW), maintenanceSchedules: [buildSchedule()], maintenanceActiveOccurrence: null };
    const parsed = StateModelSchema.safeParse(model);
    expect(parsed.success).toBe(true);
  });

  it("pre-M45 state (no maintenance keys at all) still parses -- compatibility", () => {
    const model = buildInitialStateModel(NOW) as Record<string, unknown>;
    delete model.maintenanceSchedules;
    delete model.maintenanceActiveOccurrence;
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });

  it("no schedule is ever created by migration/defaulting -- initial state model never carries a populated schedules array", () => {
    const model = buildInitialStateModel(NOW);
    expect((model as Record<string, unknown>).maintenanceSchedules).toBeUndefined();
  });
});
