import { describe, it, expect } from "vitest";
import { buildParallelBatch } from "../../src/workflow/parallel-batch.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
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

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "ready", workUnitIds: [], ...overrides };
}

function isolated(assignmentKey: string) {
  return {
    workspaceAssignment: { mode: "isolated" as const, assignmentKey, access: "read_write" as const },
    parallelPolicy: { mode: "eligible_if_no_conflict" as const, resourceClaims: [] },
  };
}

function stateWith(workUnits: WorkUnit[], dependencies: Dependency[] = []): StateModel {
  const state = buildInitialStateModel(T1);
  return {
    ...state,
    workGraph: { milestones: [milestone({ workUnitIds: workUnits.map((wu) => wu.id) })], workUnits, dependencies },
  };
}

describe("buildParallelBatch (M24 §10)", () => {
  it("returns an empty batch when there are no ready work units", () => {
    const state = stateWith([workUnit("WU001", { status: "done" })]);
    const result = buildParallelBatch(state);
    expect(result.selectedWorkUnitIds).toEqual([]);
    expect(result.primaryWorkUnitId).toBeNull();
    expect(result.manualReviewWorkUnitIds).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it("selects the single ready work unit as primary", () => {
    const state = stateWith([workUnit("WU001", { executionMetadata: isolated("wu-1") })]);
    const result = buildParallelBatch(state);
    expect(result.primaryWorkUnitId).toBe("WU001");
    expect(result.selectedWorkUnitIds).toEqual(["WU001"]);
  });

  it("selects multiple compatible ready work units with distinct isolated keys", () => {
    const state = stateWith([
      workUnit("WU001", { executionMetadata: isolated("wu-1") }),
      workUnit("WU002", { executionMetadata: isolated("wu-2") }),
      workUnit("WU003", { executionMetadata: isolated("wu-3") }),
    ]);
    const result = buildParallelBatch(state);
    expect(result.selectedWorkUnitIds.sort()).toEqual(["WU001", "WU002", "WU003"]);
  });

  it("is stable in graph order for the deterministicOrder field", () => {
    const state = stateWith([
      workUnit("WU003", { executionMetadata: isolated("wu-3") }),
      workUnit("WU001", { executionMetadata: isolated("wu-1") }),
      workUnit("WU002", { executionMetadata: isolated("wu-2") }),
    ]);
    const result = buildParallelBatch(state);
    // WU003 becomes primary (first effectively-ready in stored order per
    // the existing next selector, since it is stored first), so it leads;
    // the remainder follow stored graph order.
    expect(result.deterministicOrder).toEqual(["WU003", "WU001", "WU002"]);
  });

  it("excludes a ready candidate that conflicts with an active work unit", () => {
    const state = stateWith([
      workUnit("WU001", { status: "in_progress", executionMetadata: isolated("dup") }),
      workUnit("WU002", { executionMetadata: isolated("dup") }),
    ]);
    const result = buildParallelBatch(state);
    expect(result.selectedWorkUnitIds).toEqual([]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].workUnitId).toBe("WU002");
    expect(result.excluded[0].reasons).toContain("isolated_assignment_key_reused");
  });

  it("excludes a ready candidate that conflicts with an already-selected candidate", () => {
    const state = stateWith([
      workUnit("WU001", { executionMetadata: isolated("dup") }),
      workUnit("WU002", { executionMetadata: isolated("dup") }),
    ]);
    const result = buildParallelBatch(state);
    expect(result.selectedWorkUnitIds).toEqual(["WU001"]);
    expect(result.excluded.map((e) => e.workUnitId)).toEqual(["WU002"]);
  });

  it("separates manual_review candidates from both selected and excluded", () => {
    const state = stateWith([
      workUnit("WU001", { executionMetadata: isolated("wu-1") }),
      workUnit("WU002", {
        executionMetadata: { ...isolated("wu-2"), parallelPolicy: { mode: "manual_review", resourceClaims: [] } },
      }),
    ]);
    const result = buildParallelBatch(state);
    expect(result.manualReviewWorkUnitIds).toEqual(["WU002"]);
    expect(result.selectedWorkUnitIds).not.toContain("WU002");
    expect(result.excluded.map((e) => e.workUnitId)).not.toContain("WU002");
  });

  it("rejects a conflicting primary but still evaluates the remaining candidates", () => {
    const state = stateWith([
      workUnit("WU001", { status: "in_progress", executionMetadata: isolated("dup") }),
      workUnit("WU002", { executionMetadata: isolated("dup") }),
      workUnit("WU003", { executionMetadata: isolated("wu-3") }),
    ]);
    const result = buildParallelBatch(state);
    expect(result.excluded.map((e) => e.workUnitId)).toContain("WU002");
    expect(result.selectedWorkUnitIds).toContain("WU003");
  });

  it("produces an identical result on repeated evaluation of the same state", () => {
    const state = stateWith([
      workUnit("WU001", { executionMetadata: isolated("wu-1") }),
      workUnit("WU002", { executionMetadata: isolated("wu-2") }),
    ]);
    const first = buildParallelBatch(state);
    const second = buildParallelBatch(state);
    expect(first).toEqual(second);
  });

  it("does not mutate the input state", () => {
    const state = stateWith([
      workUnit("WU001", { executionMetadata: isolated("wu-1") }),
      workUnit("WU002", { executionMetadata: isolated("wu-2") }),
    ]);
    const before = JSON.stringify(state);
    buildParallelBatch(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("reports active work unit ids sorted deterministically", () => {
    const state = stateWith([
      workUnit("WU002", { status: "needs_review" }),
      workUnit("WU001", { status: "in_progress" }),
    ]);
    const result = buildParallelBatch(state);
    expect(result.activeWorkUnitIds).toEqual(["WU001", "WU002"]);
  });

  it("excludes a direct-dependency pair from selection together", () => {
    const deps: Dependency[] = [{ id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null }];
    // WU002 is not effectively ready while WU001 is unfinished, so this
    // exercises the case where only WU001 is ready and selected alone.
    const state = stateWith(
      [
        workUnit("WU001", { executionMetadata: isolated("wu-1") }),
        workUnit("WU002", { status: "planned", executionMetadata: isolated("wu-2") }),
      ],
      deps,
    );
    const result = buildParallelBatch(state);
    expect(result.selectedWorkUnitIds).toEqual(["WU001"]);
  });
});
