import { describe, it, expect } from "vitest";
import { evaluateParallelEligibility, type EligibilityEvaluationContext } from "../../src/workflow/parallel-eligibility.js";
import { computeEffectiveReadinessForState } from "../../src/workflow/effective-readiness.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
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

function isolated(assignmentKey: string) {
  return {
    workspaceAssignment: { mode: "isolated" as const, assignmentKey, access: "read_write" as const },
    parallelPolicy: { mode: "eligible_if_no_conflict" as const, resourceClaims: [] },
  };
}

function makeContext(
  workUnits: WorkUnit[],
  dependencies: Dependency[] = [],
  activeWorkUnitIds: string[] = [],
): EligibilityEvaluationContext {
  const state: StateModel = {
    ...buildInitialStateModel(T1),
    workGraph: { milestones: [], workUnits, dependencies },
  };
  return {
    dependencies,
    readiness: computeEffectiveReadinessForState(state),
    activeWorkUnitIds: new Set(activeWorkUnitIds),
  };
}

describe("evaluateParallelEligibility (M24 §9)", () => {
  it("is eligible for two ready, no-conflict, eligible_if_no_conflict work units with distinct isolated keys", () => {
    const left = workUnit("WU001", { executionMetadata: isolated("wu-1") });
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const context = makeContext([left, right]);
    const result = evaluateParallelEligibility(left, right, context);
    expect(result.eligible).toBe(true);
    expect(result.disposition).toBe("eligible");
    expect(result.reasons).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("is never automatically eligible when either work unit has no executionMetadata at all (conservative default) -- missing workspace metadata is itself flagged as a relational conflict per §4.4", () => {
    const left = workUnit("WU001");
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("metadata_missing");
    expect(result.reasons).toContain("parallel_policy_serialized");
    expect(result.reasons).toContain("workspace_assignment_conflict");
  });

  it("is serialized when either work unit's policy mode is explicitly serialized, with workspace metadata held constant", () => {
    const left = workUnit("WU001", {
      executionMetadata: { ...isolated("wu-1"), parallelPolicy: { mode: "serialized", resourceClaims: [] } },
    });
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.disposition).toBe("serialized");
    expect(result.reasons).toContain("parallel_policy_serialized");
  });

  it("is manual_review when either work unit's policy mode is manual_review, absent any structural conflict", () => {
    const left = workUnit("WU001", {
      executionMetadata: { ...isolated("wu-1"), parallelPolicy: { mode: "manual_review", resourceClaims: [] } },
    });
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.disposition).toBe("manual_review");
    expect(result.reasons).toEqual(["parallel_policy_manual_review"]);
  });

  it("reports invalid_metadata disposition for structurally inconsistent canonical metadata", () => {
    const left = workUnit("WU001", {
      executionMetadata: {
        workspaceAssignment: { mode: "none", access: "read_only" },
        parallelPolicy: {
          mode: "serialized",
          resourceClaims: [{ domain: "repository", key: "project", access: "exclusive" }],
        },
      } as WorkUnit["executionMetadata"],
    });
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.disposition).toBe("invalid_metadata");
    expect(result.reasons).toContain("invalid_execution_metadata");
  });

  it("reports work_unit_not_ready when a candidate is neither ready nor active", () => {
    const left = workUnit("WU001", { status: "planned", executionMetadata: isolated("wu-1") });
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.disposition).toBe("conflict");
    expect(result.reasons).toContain("work_unit_not_ready");
  });

  it("reports direct_dependency for a blocking edge between the pair", () => {
    const left = workUnit("WU001", { executionMetadata: isolated("wu-1") });
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const deps: Dependency[] = [{ id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null }];
    const result = evaluateParallelEligibility(left, right, makeContext([left, right], deps));
    expect(result.disposition).toBe("conflict");
    expect(result.reasons).toContain("direct_dependency");
    expect(result.conflicts).toContain("dependency:DEP-001");
  });

  it("reports transitive_dependency across an intermediate work unit", () => {
    const left = workUnit("WU001", { executionMetadata: isolated("wu-1") });
    const middle = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const right = workUnit("WU003", { executionMetadata: isolated("wu-3") });
    const deps: Dependency[] = [
      { id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null },
      { id: "DEP-002", fromId: "WU002", toId: "WU003", type: "blocks", reason: null },
    ];
    const result = evaluateParallelEligibility(left, right, makeContext([left, middle, right], deps));
    expect(result.disposition).toBe("conflict");
    expect(result.reasons).toContain("transitive_dependency");
  });

  it("is compatible for unrelated ready work units with no shared resources", () => {
    const left = workUnit("WU001", { executionMetadata: isolated("wu-1") });
    const right = workUnit("WU003", { executionMetadata: isolated("wu-3") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.eligible).toBe(true);
  });

  it("reports active_work_unit_conflict when a structural conflict involves an active work unit", () => {
    const left = workUnit("WU001", { status: "in_progress", executionMetadata: isolated("dup") });
    const right = workUnit("WU002", { executionMetadata: isolated("dup") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right], [], ["WU001"]));
    expect(result.reasons).toContain("isolated_assignment_key_reused");
    expect(result.reasons).toContain("active_work_unit_conflict");
  });

  it("treats needs_review the same as in_progress for active occupancy", () => {
    const left = workUnit("WU001", { status: "needs_review", executionMetadata: isolated("dup") });
    const right = workUnit("WU002", { executionMetadata: isolated("dup") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right], [], ["WU001"]));
    expect(result.reasons).toContain("active_work_unit_conflict");
  });

  it("ignores terminal work units for active-occupancy purposes", () => {
    const left = workUnit("WU001", { status: "done", executionMetadata: isolated("wu-1") });
    const right = workUnit("WU002", { executionMetadata: isolated("wu-2") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    // "done" is neither ready nor active -> work_unit_not_ready, not active_work_unit_conflict
    expect(result.reasons).toContain("work_unit_not_ready");
    expect(result.reasons).not.toContain("active_work_unit_conflict");
  });

  describe("workspace conflicts (M24 §4.4)", () => {
    it("same isolated key -> isolated_assignment_key_reused", () => {
      const left = workUnit("WU001", { executionMetadata: isolated("dup") });
      const right = workUnit("WU002", { executionMetadata: isolated("dup") });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).toContain("isolated_assignment_key_reused");
    });

    it("distinct isolated keys are compatible", () => {
      const left = workUnit("WU001", { executionMetadata: isolated("a") });
      const right = workUnit("WU002", { executionMetadata: isolated("b") });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).not.toContain("isolated_assignment_key_reused");
      expect(result.reasons).not.toContain("workspace_assignment_conflict");
    });

    it("same shared key, both read_only -- compatible", () => {
      const shared = {
        workspaceAssignment: { mode: "shared" as const, assignmentKey: "team-a", access: "read_only" as const },
        parallelPolicy: { mode: "eligible_if_no_conflict" as const, resourceClaims: [] },
      };
      const left = workUnit("WU001", { executionMetadata: shared });
      const right = workUnit("WU002", { executionMetadata: shared });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).not.toContain("workspace_assignment_conflict");
    });

    it("same shared key, one read_write -- conflict", () => {
      const sharedRW = {
        workspaceAssignment: { mode: "shared" as const, assignmentKey: "team-a", access: "read_write" as const },
        parallelPolicy: { mode: "eligible_if_no_conflict" as const, resourceClaims: [] },
      };
      const sharedRO = {
        workspaceAssignment: { mode: "shared" as const, assignmentKey: "team-a", access: "read_only" as const },
        parallelPolicy: { mode: "eligible_if_no_conflict" as const, resourceClaims: [] },
      };
      const left = workUnit("WU001", { executionMetadata: sharedRW });
      const right = workUnit("WU002", { executionMetadata: sharedRO });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).toContain("workspace_assignment_conflict");
    });

    it("both none -- compatible on the workspace axis", () => {
      const none = {
        workspaceAssignment: { mode: "none" as const, access: "read_only" as const },
        parallelPolicy: { mode: "eligible_if_no_conflict" as const, resourceClaims: [] },
      };
      const left = workUnit("WU001", { executionMetadata: none });
      const right = workUnit("WU002", { executionMetadata: none });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).not.toContain("workspace_assignment_conflict");
      expect(result.reasons).not.toContain("isolated_assignment_key_reused");
    });
  });

  describe("concurrency groups (M24 §5.3)", () => {
    it("same non-empty group conflicts", () => {
      const left = workUnit("WU001", {
        executionMetadata: {
          workspaceAssignment: { mode: "isolated", assignmentKey: "a", access: "read_write" },
          parallelPolicy: { mode: "eligible_if_no_conflict", concurrencyGroup: "g1", resourceClaims: [] },
        },
      });
      const right = workUnit("WU002", {
        executionMetadata: {
          workspaceAssignment: { mode: "isolated", assignmentKey: "b", access: "read_write" },
          parallelPolicy: { mode: "eligible_if_no_conflict", concurrencyGroup: "g1", resourceClaims: [] },
        },
      });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).toContain("concurrency_group_conflict");
    });

    it("different groups do not conflict", () => {
      const left = workUnit("WU001", {
        executionMetadata: {
          workspaceAssignment: { mode: "isolated", assignmentKey: "a", access: "read_write" },
          parallelPolicy: { mode: "eligible_if_no_conflict", concurrencyGroup: "g1", resourceClaims: [] },
        },
      });
      const right = workUnit("WU002", {
        executionMetadata: {
          workspaceAssignment: { mode: "isolated", assignmentKey: "b", access: "read_write" },
          parallelPolicy: { mode: "eligible_if_no_conflict", concurrencyGroup: "g2", resourceClaims: [] },
        },
      });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).not.toContain("concurrency_group_conflict");
    });

    it("omitted group never conflicts", () => {
      const left = workUnit("WU001", { executionMetadata: isolated("a") });
      const right = workUnit("WU002", { executionMetadata: isolated("b") });
      const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
      expect(result.reasons).not.toContain("concurrency_group_conflict");
    });
  });

  it("reports resource_claim_conflict for overlapping write path claims", () => {
    const left = workUnit("WU001", {
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "a", access: "read_write" },
        parallelPolicy: {
          mode: "eligible_if_no_conflict",
          resourceClaims: [{ domain: "path", key: "src", access: "write" }],
        },
      },
    });
    const right = workUnit("WU002", {
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "b", access: "read_write" },
        parallelPolicy: {
          mode: "eligible_if_no_conflict",
          resourceClaims: [{ domain: "path", key: "src/file.ts", access: "read" }],
        },
      },
    });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.disposition).toBe("conflict");
    expect(result.reasons).toContain("resource_claim_conflict");
  });

  it("produces no duplicate reasons even when multiple checks fire the same reason category", () => {
    const left = workUnit("WU001", { status: "planned", executionMetadata: isolated("dup") });
    const right = workUnit("WU002", { status: "planned", executionMetadata: isolated("dup") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    const seen = new Set(result.reasons);
    expect(seen.size).toBe(result.reasons.length);
  });

  it("produces multiple distinct reasons when several checks fire simultaneously", () => {
    const left = workUnit("WU001", { status: "planned", executionMetadata: isolated("dup") });
    const right = workUnit("WU002", { status: "planned", executionMetadata: isolated("dup") });
    const deps: Dependency[] = [{ id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null }];
    const result = evaluateParallelEligibility(left, right, makeContext([left, right], deps));
    expect(result.reasons.length).toBeGreaterThan(1);
    expect(result.reasons).toContain("work_unit_not_ready");
    expect(result.reasons).toContain("direct_dependency");
    expect(result.reasons).toContain("isolated_assignment_key_reused");
  });

  it("is stable across repeated evaluation of the same inputs", () => {
    const left = workUnit("WU001", { executionMetadata: isolated("a") });
    const right = workUnit("WU002", { executionMetadata: isolated("b") });
    const context = makeContext([left, right]);
    const first = evaluateParallelEligibility(left, right, context);
    const second = evaluateParallelEligibility(left, right, context);
    expect(first).toEqual(second);
  });

  it("eligible implies empty reasons and conflicts (never eligible with residual entries)", () => {
    const left = workUnit("WU001", { executionMetadata: isolated("a") });
    const right = workUnit("WU002", { executionMetadata: isolated("b") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    if (result.eligible) {
      expect(result.reasons).toEqual([]);
      expect(result.conflicts).toEqual([]);
    }
  });

  it("reasons are sorted deterministically", () => {
    const left = workUnit("WU001", { status: "planned", executionMetadata: isolated("dup") });
    const right = workUnit("WU002", { status: "planned", executionMetadata: isolated("dup") });
    const result = evaluateParallelEligibility(left, right, makeContext([left, right]));
    expect(result.reasons).toEqual([...result.reasons].sort());
  });
});
