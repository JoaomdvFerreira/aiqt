import { describe, it, expect } from "vitest";
import { evaluateParallelEligibility } from "../../src/workflow/parallel-eligibility.js";
import { buildParallelBatch } from "../../src/workflow/parallel-batch.js";
import { computeEffectiveReadinessForState } from "../../src/workflow/effective-readiness.js";
import {
  CONFLICTS_PER_PAIR_MAX,
  ADVISORY_BATCH_WORK_UNITS_MAX,
  ELIGIBILITY_REASONS_PER_PAIR_MAX,
} from "../../src/schema/execution-metadata.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ResourceClaim } from "../../src/schema/execution-metadata.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";

function workUnit(id: string, overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id,
    milestoneId: "M001",
    title: "T",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "ready", workUnitIds: [], ...overrides };
}

function stateWith(workUnits: WorkUnit[]): StateModel {
  const state = buildInitialStateModel(T1);
  return {
    ...state,
    workGraph: { milestones: [milestone({ workUnitIds: workUnits.map((wu) => wu.id) })], workUnits, dependencies: [] },
  };
}

describe("M24 §15 state-growth limits (WU24-08 hardening)", () => {
  it("truncates the conflicts array to CONFLICTS_PER_PAIR_MAX when a resource-claim conflict produces more entries than the cap", () => {
    // 100 distinct custom-domain claims on each side (the maximum allowed
    // per Work Unit, so the metadata itself stays valid); exactly one pair
    // (key "shared") shares a key and conflicts, which makes
    // anyResourceClaimsConflict true and causes every claim on both
    // sides to be recorded as a conflict entry -- up to 200 potential
    // entries, comfortably exceeding the 100-entry conflicts cap.
    const leftClaims: ResourceClaim[] = Array.from({ length: 100 }, (_, i) => ({
      domain: "custom" as const,
      key: i === 0 ? "shared" : `left-${i}`,
      access: "read" as const,
    }));
    const rightClaims: ResourceClaim[] = Array.from({ length: 100 }, (_, i) => ({
      domain: "custom" as const,
      key: i === 0 ? "shared" : `right-${i}`,
      access: "write" as const,
    }));
    const left = workUnit("WU001", {
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "a", access: "read_write" },
        parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: leftClaims },
      },
    });
    const right = workUnit("WU002", {
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "b", access: "read_write" },
        parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: rightClaims },
      },
    });
    const state = stateWith([left, right]);
    const result = evaluateParallelEligibility(left, right, {
      dependencies: state.workGraph.dependencies,
      readiness: computeEffectiveReadinessForState(state),
      activeWorkUnitIds: new Set(),
    });
    expect(result.reasons).toContain("resource_claim_conflict");
    expect(result.conflicts.length).toBeLessThanOrEqual(CONFLICTS_PER_PAIR_MAX);
    expect(result.conflicts.length).toBe(CONFLICTS_PER_PAIR_MAX);
  });

  it("the reasons vocabulary (12 codes) can never exceed ELIGIBILITY_REASONS_PER_PAIR_MAX (32) -- the cap is a defensive ceiling, not reachable via any real evaluation", () => {
    expect(ELIGIBILITY_REASONS_PER_PAIR_MAX).toBeGreaterThanOrEqual(12);
  });

  it(
    "buildParallelBatch caps candidate consideration at ADVISORY_BATCH_WORK_UNITS_MAX and degrades deterministically rather than growing unbounded",
    () => {
      const totalWorkUnits = ADVISORY_BATCH_WORK_UNITS_MAX + 5;
      const workUnits = Array.from({ length: totalWorkUnits }, (_, i) =>
        workUnit(`WU${String(i + 1).padStart(6, "0")}`),
      );
      const state = stateWith(workUnits);
      const result = buildParallelBatch(state);
      expect(result.deterministicOrder.length).toBeLessThanOrEqual(ADVISORY_BATCH_WORK_UNITS_MAX);
    },
    20000,
  );
});
