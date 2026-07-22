import { describe, it, expect } from "vitest";
import {
  buildManagedWorkspaceAdvisory,
  renderManagedWorkspaceSection,
} from "../../src/workflow/managed-workspace-advisory.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { ManagedWorkspace } from "../../src/schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../../src/schema/workspace-binding.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";
const SHA = "a".repeat(40);

function workUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
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
    ...overrides,
  };
}

function stateWith(managedWorkspaces: ManagedWorkspace[] = [], workspaceBindings: WorkspaceBinding[] = []): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workspace: { managedWorkspaces, workspaceBindings, pendingWorkspaceOperations: [] } };
}

describe("buildManagedWorkspaceAdvisory (M25 §18)", () => {
  it("is not applicable when the effective mode is 'none'", () => {
    const wu = workUnit({
      executionMetadata: {
        workspaceAssignment: { mode: "none", access: "read_only" },
        parallelPolicy: { mode: "serialized", resourceClaims: [] },
      },
    });
    const advisory = buildManagedWorkspaceAdvisory(wu, stateWith());
    expect(advisory.applicable).toBe(false);
    expect(advisory.workspacePrepared).toBe(false);
  });

  it("is not applicable when no M24 metadata is declared (mode unknown)", () => {
    const advisory = buildManagedWorkspaceAdvisory(workUnit(), stateWith());
    expect(advisory.applicable).toBe(false);
  });

  it("is applicable but unprepared when isolated/shared mode has no active binding", () => {
    const wu = workUnit({
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
        parallelPolicy: { mode: "serialized", resourceClaims: [] },
      },
    });
    const advisory = buildManagedWorkspaceAdvisory(wu, stateWith());
    expect(advisory.applicable).toBe(true);
    expect(advisory.workspacePrepared).toBe(false);
  });

  it("reports full facts when an active binding and workspace exist", () => {
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
      branchName: "aiqt/p/wu001-abc",
      baseCommit: SHA,
      lifecycleStatus: "ready",
      createdAt: T1,
    };
    const binding: WorkspaceBinding = { id: "WSB-001", workUnitId: "WU001", workspaceId: "WS-001", status: "active", boundAt: T1 };
    const wu = workUnit({
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
        parallelPolicy: { mode: "serialized", resourceClaims: [] },
      },
    });
    const advisory = buildManagedWorkspaceAdvisory(wu, stateWith([workspace], [binding]));
    expect(advisory.applicable).toBe(true);
    expect(advisory.workspacePrepared).toBe(true);
    expect(advisory.providerId).toBe("git-worktree@1");
    expect(advisory.workspacePath).toBe("/workspaces/WS-001");
    expect(advisory.branchName).toBe("aiqt/p/wu001-abc");
    expect(advisory.baseCommit).toBe(SHA);
  });
});

describe("renderManagedWorkspaceSection (M25 §18)", () => {
  it("states no repository workspace is required for mode none", () => {
    const text = renderManagedWorkspaceSection({ applicable: false, workspacePrepared: false });
    expect(text).toContain("Managed Workspace");
    expect(text).toContain("No repository workspace is required");
  });

  it("gives a stable instruction to run prepare when applicable but unprepared", () => {
    const text = renderManagedWorkspaceSection({ applicable: true, workspacePrepared: false });
    expect(text).toContain("workspacePrepared: false");
    expect(text).toContain("aiqt workspace prepare");
  });

  it("never claims an agent was started, and includes provider/path/branch when prepared", () => {
    const text = renderManagedWorkspaceSection({
      applicable: true,
      workspacePrepared: true,
      providerId: "git-worktree@1",
      workspaceMode: "isolated",
      workspacePath: "/workspaces/WS-001",
      branchName: "aiqt/p/wu001-abc",
      baseCommit: SHA,
      inspectionStatus: "ready_canonical_not_git_verified",
    });
    expect(text).toContain("workspacePrepared: true");
    expect(text).toContain("/workspaces/WS-001");
    expect(text).toContain("aiqt/p/wu001-abc");
    expect(text).toContain("does not start the work unit");
  });
});
