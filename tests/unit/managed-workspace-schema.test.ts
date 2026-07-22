import { describe, it, expect } from "vitest";
import { ManagedWorkspaceSchema, WorkspaceStateSchema } from "../../src/schema/managed-workspace.schema.js";
import { WorkspaceBindingSchema } from "../../src/schema/workspace-binding.schema.js";
import { PendingWorkspaceOperationSchema } from "../../src/schema/pending-workspace-operation.schema.js";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";
const SHA = "a".repeat(40);

function sharedWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "WS-001",
    workspaceSeriesKey: "series-key",
    generation: 1,
    providerId: "shared-repository@1",
    assignmentKey: "team-a",
    mode: "shared",
    access: "read_write",
    implementationRoot: "/repo",
    workspacePath: "/repo",
    baseCommit: SHA,
    lifecycleStatus: "ready",
    createdAt: T1,
    ...overrides,
  };
}

function isolatedWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "WS-002",
    workspaceSeriesKey: "series-key-2",
    generation: 1,
    providerId: "git-worktree@1",
    assignmentKey: "wu-1",
    mode: "isolated",
    access: "read_write",
    implementationRoot: "/repo",
    workspacePath: "/workspaces/WS-002",
    branchName: "aiqt/proj/wu1-abcdef",
    baseCommit: SHA,
    lifecycleStatus: "ready",
    createdAt: T1,
    ...overrides,
  };
}

describe("ManagedWorkspaceSchema (M25 §5.1)", () => {
  it("accepts a valid shared workspace with no branchName", () => {
    expect(ManagedWorkspaceSchema.safeParse(sharedWorkspace()).success).toBe(true);
  });

  it("accepts a valid isolated workspace with a branchName", () => {
    expect(ManagedWorkspaceSchema.safeParse(isolatedWorkspace()).success).toBe(true);
  });

  it("rejects a git-worktree@1 workspace with no branchName", () => {
    const result = ManagedWorkspaceSchema.safeParse(isolatedWorkspace({ branchName: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects an invalid baseCommit (not a full 40-hex SHA)", () => {
    expect(ManagedWorkspaceSchema.safeParse(sharedWorkspace({ baseCommit: "abc123" })).success).toBe(false);
  });

  it("rejects an unknown providerId", () => {
    expect(ManagedWorkspaceSchema.safeParse(sharedWorkspace({ providerId: "custom-provider@1" })).success).toBe(
      false,
    );
  });

  it("rejects generation 0 or negative", () => {
    expect(ManagedWorkspaceSchema.safeParse(sharedWorkspace({ generation: 0 })).success).toBe(false);
    expect(ManagedWorkspaceSchema.safeParse(sharedWorkspace({ generation: -1 })).success).toBe(false);
  });

  it("rejects an unknown field (strict, no credential/session/process fields)", () => {
    expect(ManagedWorkspaceSchema.safeParse(sharedWorkspace({ credentialToken: "x" })).success).toBe(false);
    expect(ManagedWorkspaceSchema.safeParse(sharedWorkspace({ dirty: false })).success).toBe(false);
  });

  it("accepts a released record with releasedAt", () => {
    expect(
      ManagedWorkspaceSchema.safeParse(sharedWorkspace({ lifecycleStatus: "released", releasedAt: T1 })).success,
    ).toBe(true);
  });
});

describe("WorkspaceBindingSchema (M25 §5.2)", () => {
  it("accepts a valid active binding", () => {
    expect(
      WorkspaceBindingSchema.safeParse({
        id: "WSB-001",
        workUnitId: "WU001",
        workspaceId: "WS-001",
        status: "active",
        boundAt: T1,
      }).success,
    ).toBe(true);
  });

  it("accepts a released binding with releasedAt", () => {
    expect(
      WorkspaceBindingSchema.safeParse({
        id: "WSB-001",
        workUnitId: "WU001",
        workspaceId: "WS-001",
        status: "released",
        boundAt: T1,
        releasedAt: T1,
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(
      WorkspaceBindingSchema.safeParse({
        id: "WSB-001",
        workUnitId: "WU001",
        workspaceId: "WS-001",
        status: "bogus",
        boundAt: T1,
      }).success,
    ).toBe(false);
  });
});

describe("PendingWorkspaceOperationSchema (M25 §5.3)", () => {
  it("accepts a valid pending prepare", () => {
    expect(
      PendingWorkspaceOperationSchema.safeParse({
        id: "op-hash",
        type: "prepare",
        workUnitId: "WU001",
        workspaceId: "WS-001",
        workspaceSeriesKey: "series-key",
        generation: 1,
        providerId: "git-worktree@1",
        expectedWorkspacePath: "/workspaces/WS-001",
        expectedBranchName: "aiqt/proj/wu1-abcdef",
        baseCommit: SHA,
        createdAt: T1,
      }).success,
    ).toBe(true);
  });

  it("rejects generation 0", () => {
    expect(
      PendingWorkspaceOperationSchema.safeParse({
        id: "op-hash",
        type: "prepare",
        workUnitId: "WU001",
        workspaceId: "WS-001",
        workspaceSeriesKey: "series-key",
        generation: 0,
        providerId: "git-worktree@1",
        expectedWorkspacePath: "/workspaces/WS-001",
        baseCommit: SHA,
        createdAt: T1,
      }).success,
    ).toBe(false);
  });
});

describe("StateModelSchema additive integration (M25 §5)", () => {
  it("parses a historical state with no workspace field at all", () => {
    const state = buildInitialStateModel(T1);
    const result = StateModelSchema.safeParse(state);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.workspace).toBeUndefined();
  });

  it("parses a state with a populated workspace section", () => {
    const state = {
      ...buildInitialStateModel(T1),
      workspace: {
        managedWorkspaces: [sharedWorkspace()],
        workspaceBindings: [],
        pendingWorkspaceOperations: [],
      },
    };
    const result = StateModelSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it("WorkspaceStateSchema rejects more than the managed-workspace cap", () => {
    const workspaces = Array.from({ length: 5001 }, (_, i) => sharedWorkspace({ id: `WS-${i}` }));
    expect(
      WorkspaceStateSchema.safeParse({
        managedWorkspaces: workspaces,
        workspaceBindings: [],
        pendingWorkspaceOperations: [],
      }).success,
    ).toBe(false);
  });
});
