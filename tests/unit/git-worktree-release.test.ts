import { describe, it, expect } from "vitest";
import {
  planGitWorktreeRelease,
  buildPendingReleaseOperation,
  buildReleaseFinalizeCandidate,
} from "../../src/workspaces/git-worktree-provider.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ManagedWorkspace } from "../../src/schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../../src/schema/workspace-binding.schema.js";
import type { PendingWorkspaceOperation } from "../../src/schema/pending-workspace-operation.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const SHA_A = "a".repeat(40);

function stateWith(
  managedWorkspaces: ManagedWorkspace[] = [],
  workspaceBindings: WorkspaceBinding[] = [],
  pendingWorkspaceOperations: PendingWorkspaceOperation[] = [],
): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workspace: { managedWorkspaces, workspaceBindings, pendingWorkspaceOperations } };
}

function isolatedWorkspace(overrides: Partial<ManagedWorkspace> = {}): ManagedWorkspace {
  return {
    id: "WS-001",
    workspaceSeriesKey: "series-1",
    generation: 1,
    providerId: "git-worktree@1",
    assignmentKey: "wu-1",
    mode: "isolated",
    access: "read_write",
    implementationRoot: "/repo",
    workspacePath: "/workspaces/WS-001",
    branchName: "aiqt/p001/wu001-abc123",
    baseCommit: SHA_A,
    lifecycleStatus: "ready",
    createdAt: T1,
    ...overrides,
  };
}

function activeBinding(overrides: Partial<WorkspaceBinding> = {}): WorkspaceBinding {
  return { id: "WSB-001", workUnitId: "WU001", workspaceId: "WS-001", status: "active", boundAt: T1, ...overrides };
}

describe("planGitWorktreeRelease (M25 §12.2/§14.2)", () => {
  it("is a no-op when the work unit has no active binding", () => {
    const result = planGitWorktreeRelease({ state: stateWith(), workUnitId: "WU999" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.kind).toBe("no_op");
  });

  it("plans a release when an active isolated binding exists", () => {
    const workspace = isolatedWorkspace();
    const binding = activeBinding();
    const result = planGitWorktreeRelease({ state: stateWith([workspace], [binding]), workUnitId: "WU001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.kind).toBe("release");
    if (result.action.kind !== "release") return;
    expect(result.action.workspace.id).toBe("WS-001");
  });

  it("rejects a binding that references a non-isolated provider", () => {
    const workspace = isolatedWorkspace({ providerId: "shared-repository@1", mode: "shared" });
    const binding = activeBinding();
    const result = planGitWorktreeRelease({ state: stateWith([workspace], [binding]), workUnitId: "WU001" });
    expect(result.ok).toBe(false);
  });

  it("recovers an existing pending operation for the workspace instead of releasing again", () => {
    const workspace = isolatedWorkspace();
    const binding = activeBinding();
    const pending: PendingWorkspaceOperation = {
      id: "pending-release-1",
      type: "release",
      workUnitId: "WU001",
      workspaceId: "WS-001",
      workspaceSeriesKey: "series-1",
      generation: 1,
      providerId: "git-worktree@1",
      expectedWorkspacePath: "/workspaces/WS-001",
      expectedBranchName: "aiqt/p001/wu001-abc123",
      baseCommit: SHA_A,
      createdAt: T1,
    };
    const result = planGitWorktreeRelease({
      state: stateWith([workspace], [binding], [pending]),
      workUnitId: "WU001",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.kind).toBe("recover_pending");
  });
});

describe("buildPendingReleaseOperation / buildReleaseFinalizeCandidate (M25 §14.2)", () => {
  it("finalize releases the binding and workspace, removing the pending operation", () => {
    const workspace = isolatedWorkspace();
    const binding = activeBinding();
    const pending = buildPendingReleaseOperation({ workUnitId: "WU001", workspace, timestamp: T2 });
    const state = stateWith([workspace], [binding], [pending]);

    let n = 0;
    const finalized = buildReleaseFinalizeCandidate({
      state,
      pending,
      timestamp: T2,
      nextEventId: () => `EVT-${++n}`,
    });

    expect(finalized.pendingWorkspaceOperations).toEqual([]);
    const releasedWorkspace = finalized.managedWorkspaces.find((w) => w.id === "WS-001")!;
    expect(releasedWorkspace.lifecycleStatus).toBe("released");
    expect(releasedWorkspace.releasedAt).toBe(T2);
    const releasedBinding = finalized.workspaceBindings.find((b) => b.id === "WSB-001")!;
    expect(releasedBinding.status).toBe("released");
    expect(finalized.runlogEvents.map((e) => e.type)).toEqual(["workspace.binding_released", "workspace.released"]);
  });

  it("prior other-series workspaces are untouched by an unrelated release", () => {
    const workspaceA = isolatedWorkspace();
    const workspaceB = isolatedWorkspace({ id: "WS-002", workspaceSeriesKey: "series-2", assignmentKey: "wu-2" });
    const bindingA = activeBinding();
    const pending = buildPendingReleaseOperation({ workUnitId: "WU001", workspace: workspaceA, timestamp: T2 });
    const state = stateWith([workspaceA, workspaceB], [bindingA], [pending]);

    let n = 0;
    const finalized = buildReleaseFinalizeCandidate({ state, pending, timestamp: T2, nextEventId: () => `EVT-${++n}` });
    const untouched = finalized.managedWorkspaces.find((w) => w.id === "WS-002")!;
    expect(untouched.lifecycleStatus).toBe("ready");
  });
});
