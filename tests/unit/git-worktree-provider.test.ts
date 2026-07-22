import { describe, it, expect } from "vitest";
import {
  planGitWorktreePrepare,
  buildPendingPrepareOperation,
  buildPrepareFinalizeCandidate,
} from "../../src/workspaces/git-worktree-provider.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ManagedWorkspace } from "../../src/schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../../src/schema/workspace-binding.schema.js";
import type { PendingWorkspaceOperation } from "../../src/schema/pending-workspace-operation.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function stateWith(
  managedWorkspaces: ManagedWorkspace[] = [],
  workspaceBindings: WorkspaceBinding[] = [],
  pendingWorkspaceOperations: PendingWorkspaceOperation[] = [],
): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workspace: { managedWorkspaces, workspaceBindings, pendingWorkspaceOperations } };
}

function baseParams(state: StateModel, overrides: Record<string, unknown> = {}) {
  return {
    state,
    projectId: "P001",
    workUnitId: "WU001",
    assignmentKey: "wu-1",
    access: "read_write" as const,
    implementationRoot: "/repo",
    workspaceRoot: "/workspaces",
    headCommit: SHA_A,
    ...overrides,
  };
}

describe("planGitWorktreePrepare (M25 §10.3/§14.1)", () => {
  it("plans a brand-new prepare with generation 1 when there is no history", () => {
    const result = planGitWorktreePrepare(baseParams(stateWith()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.kind).toBe("prepare_new");
    if (result.action.kind !== "prepare_new") return;
    expect(result.action.generation).toBe(1);
    expect(result.action.workspacePath.endsWith(result.action.workspaceId)).toBe(true);
    expect(result.action.branchName.startsWith("aiqt/")).toBe(true);
  });

  it("is a no_op when the work unit already has an active isolated binding", () => {
    const workspace: ManagedWorkspace = {
      id: "WS-001",
      workspaceSeriesKey: "series",
      generation: 1,
      providerId: "git-worktree@1",
      assignmentKey: "wu-1",
      mode: "isolated",
      access: "read_write",
      implementationRoot: "/repo",
      workspacePath: "/workspaces/WS-001",
      branchName: "aiqt/p001/wu001-abc",
      baseCommit: SHA_A,
      lifecycleStatus: "ready",
      createdAt: T1,
    };
    const binding: WorkspaceBinding = {
      id: "WSB-001",
      workUnitId: "WU001",
      workspaceId: "WS-001",
      status: "active",
      boundAt: T1,
    };
    const result = planGitWorktreePrepare(baseParams(stateWith([workspace], [binding])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.kind).toBe("no_op");
  });

  it("recovers a pending prepare rather than allocating a new generation", () => {
    const pending: PendingWorkspaceOperation = {
      id: "pending-1",
      type: "prepare",
      workUnitId: "WU001",
      workspaceId: "WS-001",
      workspaceSeriesKey: "series",
      generation: 1,
      providerId: "git-worktree@1",
      expectedWorkspacePath: "/workspaces/WS-001",
      expectedBranchName: "aiqt/p001/wu001-abc",
      baseCommit: SHA_A,
      createdAt: T1,
    };
    const result = planGitWorktreePrepare(baseParams(stateWith([], [], [pending])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.kind).toBe("recover_pending");
  });

  it("allocates the next generation when the latest instance for the series is released", () => {
    const released: ManagedWorkspace = {
      id: "WS-001",
      workspaceSeriesKey: "will-be-recomputed",
      generation: 1,
      providerId: "git-worktree@1",
      assignmentKey: "wu-1",
      mode: "isolated",
      access: "read_write",
      implementationRoot: "/repo",
      workspacePath: "/workspaces/WS-001",
      branchName: "aiqt/p001/wu001-abc",
      baseCommit: SHA_A,
      lifecycleStatus: "released",
      releasedAt: T1,
      createdAt: T1,
    };
    // Recompute the real series key so the released record actually
    // belongs to the same series the plan will derive.
    const params = baseParams(stateWith());
    const planFirst = planGitWorktreePrepare(params);
    if (!planFirst.ok || planFirst.action.kind !== "prepare_new") return;
    const seriesKey = planFirst.action.workspaceSeriesKey;

    const result = planGitWorktreePrepare(
      baseParams(stateWith([{ ...released, workspaceSeriesKey: seriesKey }])),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.kind).toBe("prepare_new");
    if (result.action.kind !== "prepare_new") return;
    expect(result.action.generation).toBe(2);
    expect(result.action.workspaceId).not.toBe("WS-001");
  });

  it("different base commits produce different series (and therefore independent generation counters)", () => {
    const a = planGitWorktreePrepare(baseParams(stateWith(), { headCommit: SHA_A }));
    const b = planGitWorktreePrepare(baseParams(stateWith(), { headCommit: SHA_B }));
    if (!a.ok || !b.ok || a.action.kind !== "prepare_new" || b.action.kind !== "prepare_new") return;
    expect(a.action.workspaceSeriesKey).not.toBe(b.action.workspaceSeriesKey);
  });
});

describe("buildPendingPrepareOperation / buildPrepareFinalizeCandidate", () => {
  it("finalize removes the pending operation and creates the workspace+binding", () => {
    const pending = buildPendingPrepareOperation({
      workUnitId: "WU001",
      workspaceId: "WS-001",
      workspaceSeriesKey: "series",
      generation: 1,
      workspacePath: "/workspaces/WS-001",
      branchName: "aiqt/p001/wu001-abc",
      baseCommit: SHA_A,
      timestamp: T1,
      assignmentKey: "wu-1",
      access: "read_write",
    });
    const state = stateWith([], [], [pending]);
    let n = 0;
    const finalized = buildPrepareFinalizeCandidate({
      state,
      pending,
      implementationRoot: "/repo",
      timestamp: T1,
      nextEventId: () => `EVT-${++n}`,
    });
    expect(finalized.pendingWorkspaceOperations).toEqual([]);
    expect(finalized.managedWorkspaces).toHaveLength(1);
    expect(finalized.workspaceBindings).toHaveLength(1);
    expect(finalized.workspace.branchName).toBe("aiqt/p001/wu001-abc");
    expect(finalized.runlogEvents.map((e) => e.type)).toEqual(["workspace.prepared", "workspace.binding_created"]);
  });
});
