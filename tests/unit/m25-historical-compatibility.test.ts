import { describe, it, expect } from "vitest";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { getManagedWorkspaces, getWorkspaceBindings, getPendingWorkspaceOperations } from "../../src/services/workspace-state-service.js";
import { getExecutionSessions } from "../../src/services/execution-session-service.js";
import { buildParallelBatch } from "../../src/workflow/parallel-batch.js";

const T1 = "2026-01-01T00:00:00.000Z";

function historicalWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "Pre-M25 work",
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
    // No executionMetadata field at all -- pre-M24/M25 shape.
    ...overrides,
  };
}

function historicalMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "ready", workUnitIds: ["WU001"], ...overrides };
}

function preM25State(workUnits: WorkUnit[] = [historicalWorkUnit()]): StateModel {
  const base = buildInitialStateModel(T1);
  return {
    ...base,
    workGraph: { milestones: [historicalMilestone({ workUnitIds: workUnits.map((wu) => wu.id) })], workUnits, dependencies: [] },
    // No `workspace` field at all -- the exact pre-M25 shape.
  };
}

describe("M25 historical compatibility", () => {
  it("a pre-M25 state (no workspace field) parses via StateModelSchema", () => {
    const state = preM25State();
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.workspace).toBeUndefined();
  });

  it("buildInitialStateModel never materializes workspace", () => {
    expect(buildInitialStateModel(T1).workspace).toBeUndefined();
  });

  it("workspace-state-service finders never materialize a default onto the state object", () => {
    const state = preM25State();
    getManagedWorkspaces(state);
    getWorkspaceBindings(state);
    getPendingWorkspaceOperations(state);
    expect(state.workspace).toBeUndefined();
  });

  it("buildParallelBatch (M24) completes without error over a pre-M25 graph with no workspace state", () => {
    const state = preM25State([historicalWorkUnit({ id: "WU001" }), historicalWorkUnit({ id: "WU002", milestoneId: "M001" })]);
    expect(() => buildParallelBatch(state)).not.toThrow();
  });

  it("a state with M25 workspace fields alongside a pre-M26 work unit still parses and is unaffected by M26", () => {
    const state: StateModel = {
      ...preM25State(),
      workspace: {
        managedWorkspaces: [
          {
            id: "WS-001",
            workspaceSeriesKey: "series-1",
            generation: 1,
            providerId: "shared-repository@1",
            assignmentKey: "team-a",
            mode: "shared",
            access: "read_write",
            implementationRoot: "/repo",
            workspacePath: "/repo",
            baseCommit: "a".repeat(40),
            lifecycleStatus: "ready",
            createdAt: T1,
          },
        ],
        workspaceBindings: [],
        pendingWorkspaceOperations: [],
      },
    };
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.executionSessions).toBeUndefined();
    expect(parsed.data.workspace?.managedWorkspaces).toHaveLength(1);
    expect(getExecutionSessions(parsed.data)).toEqual([]);
  });
});
