import { describe, it, expect } from "vitest";
import { computeWorkspaceReadiness } from "../../src/workflow/workspace-readiness-advisory.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { ManagedWorkspace } from "../../src/schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../../src/schema/workspace-binding.schema.js";
import type { PendingWorkspaceOperation } from "../../src/schema/pending-workspace-operation.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";
const SHA = "a".repeat(40);

function workUnit(id: string, mode: "isolated" | "shared" | "none" | undefined): WorkUnit {
  return {
    id,
    milestoneId: "M001",
    title: "T",
    objective: "O",
    scope: [],
    outOfScope: [],
    acceptanceCriteria: [],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: [],
    status: "ready",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    executionMetadata: mode
      ? {
          workspaceAssignment:
            mode === "none" ? { mode: "none", access: "read_only" } : { mode, assignmentKey: `${id}-key`, access: "read_write" },
          parallelPolicy: { mode: "serialized", resourceClaims: [] },
        }
      : undefined,
  };
}

function isolatedWorkspace(id: string, workUnitId: string): { workspace: ManagedWorkspace; binding: WorkspaceBinding } {
  return {
    workspace: {
      id: `WS-${id}`,
      workspaceSeriesKey: `series-${id}`,
      generation: 1,
      providerId: "git-worktree@1",
      assignmentKey: `${workUnitId}-key`,
      mode: "isolated",
      access: "read_write",
      implementationRoot: "/repo",
      workspacePath: "/does/not/exist/on/disk",
      branchName: `aiqt/p/${id}-abc`,
      baseCommit: SHA,
      lifecycleStatus: "ready",
      createdAt: T1,
    },
    binding: { id: `WSB-${id}`, workUnitId, workspaceId: `WS-${id}`, status: "active", boundAt: T1 },
  };
}

function stateWith(
  workUnits: WorkUnit[],
  managedWorkspaces: ManagedWorkspace[] = [],
  workspaceBindings: WorkspaceBinding[] = [],
  pendingWorkspaceOperations: PendingWorkspaceOperation[] = [],
): StateModel {
  const state = buildInitialStateModel(T1);
  return {
    ...state,
    workGraph: { ...state.workGraph, workUnits, milestones: state.workGraph.milestones },
    workspace: { managedWorkspaces, workspaceBindings, pendingWorkspaceOperations },
  };
}

describe("computeWorkspaceReadiness (M25 §19)", () => {
  it("excludes mode 'none' and unresolved-metadata work units entirely", () => {
    const state = stateWith([workUnit("WU001", "none"), workUnit("WU002", undefined)]);
    const summary = computeWorkspaceReadiness(state, ["WU001", "WU002"], "/nonexistent-implementation-root");
    expect(summary.prepared).toBe(0);
    expect(summary.unprepared).toBe(0);
  });

  it("counts an isolated/shared work unit with no active binding as unprepared", () => {
    const state = stateWith([workUnit("WU001", "isolated"), workUnit("WU002", "shared")]);
    const summary = computeWorkspaceReadiness(state, ["WU001", "WU002"], "/nonexistent-implementation-root");
    expect(summary.unprepared).toBe(2);
    expect(summary.prepared).toBe(0);
  });

  it("counts a work unit with an active binding as prepared", () => {
    const { workspace, binding } = isolatedWorkspace("001", "WU001");
    const state = stateWith([workUnit("WU001", "isolated")], [workspace], [binding]);
    // Non-Git implementation root -> gitIsInsideWorkTree is false -> no live
    // inspection is attempted, dirty/drifted stay 0 rather than guessing.
    const summary = computeWorkspaceReadiness(state, ["WU001"], "/nonexistent-implementation-root");
    expect(summary.prepared).toBe(1);
    expect(summary.dirty).toBe(0);
    expect(summary.drifted).toBe(0);
  });

  it("reports recoveryRequired from the total pending operation count, independent of the ready set", () => {
    const pending: PendingWorkspaceOperation = {
      id: "pending-1",
      type: "prepare",
      workUnitId: "WU999",
      workspaceId: "WS-999",
      workspaceSeriesKey: "series-999",
      generation: 1,
      providerId: "git-worktree@1",
      expectedWorkspacePath: "/workspaces/WS-999",
      expectedBranchName: "aiqt/p/999-abc",
      baseCommit: SHA,
      createdAt: T1,
    };
    const state = stateWith([workUnit("WU001", "isolated")], [], [], [pending]);
    const summary = computeWorkspaceReadiness(state, ["WU001"], "/nonexistent-implementation-root");
    expect(summary.recoveryRequired).toBe(1);
  });

  it("only scores work units in the given ready set, ignoring the rest of the graph", () => {
    const state = stateWith([workUnit("WU001", "isolated"), workUnit("WU002", "isolated")]);
    const summary = computeWorkspaceReadiness(state, ["WU001"], "/nonexistent-implementation-root");
    expect(summary.unprepared).toBe(1);
  });
});
