import { describe, it, expect } from "vitest";
import {
  buildSharedWorkspacePrepareCandidate,
  buildSharedWorkspaceReleaseCandidate,
} from "../../src/workspaces/shared-repository-provider.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ManagedWorkspace } from "../../src/schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../../src/schema/workspace-binding.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const SHA = "a".repeat(40);

function eventIdSequence(): () => string {
  let n = 0;
  return () => `EVT-${String(++n).padStart(3, "0")}`;
}

function stateWithWorkspace(managedWorkspaces: ManagedWorkspace[] = [], workspaceBindings: WorkspaceBinding[] = []): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workspace: { managedWorkspaces, workspaceBindings, pendingWorkspaceOperations: [] } };
}

function baseParams(state: StateModel, overrides: Record<string, unknown> = {}) {
  return {
    state,
    projectId: "P001",
    workUnitId: "WU001",
    assignmentKey: "team-a",
    access: "read_write" as const,
    implementationRoot: "/repo",
    headCommit: SHA,
    isDirty: false,
    timestamp: T1,
    nextEventId: eventIdSequence(),
    ...overrides,
  };
}

describe("buildSharedWorkspacePrepareCandidate (M25 §9)", () => {
  it("creates a new shared workspace and binding on first prepare", () => {
    const state = stateWithWorkspace();
    const result = buildSharedWorkspacePrepareCandidate(baseParams(state));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("created");
    expect(result.workspace.mode).toBe("shared");
    expect(result.workspace.workspacePath).toBe("/repo");
    expect(result.workspace.generation).toBe(1);
    expect(result.binding.workUnitId).toBe("WU001");
    expect(result.runlogEvents.some((e) => e.type === "workspace.prepared")).toBe(true);
    expect(result.runlogEvents.some((e) => e.type === "workspace.binding_created")).toBe(true);
  });

  it("creates no physical directory or Git side effect (pure candidate builder -- no fs/git import in this module)", () => {
    // Structural guarantee: this module imports no node:fs or git-command-runner
    // functions -- verified by static review, exercised here by confirming
    // the function completes with only in-memory records for a
    // nonexistent path.
    const state = stateWithWorkspace();
    const result = buildSharedWorkspacePrepareCandidate(
      baseParams(state, { implementationRoot: "/definitely/does/not/exist" }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows multiple bindings to the same active shared workspace", () => {
    const state = stateWithWorkspace();
    const first = buildSharedWorkspacePrepareCandidate(baseParams(state));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stateAfterFirst = stateWithWorkspace(first.managedWorkspaces, first.workspaceBindings);

    const second = buildSharedWorkspacePrepareCandidate(
      baseParams(stateAfterFirst, { workUnitId: "WU002" }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome).toBe("linked");
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.workspaceBindings.filter((b) => b.status === "active")).toHaveLength(2);
  });

  it("is idempotent (no_op) for a repeated prepare of the same work unit", () => {
    const state = stateWithWorkspace();
    const first = buildSharedWorkspacePrepareCandidate(baseParams(state));
    if (!first.ok) return;
    const stateAfterFirst = stateWithWorkspace(first.managedWorkspaces, first.workspaceBindings);

    const second = buildSharedWorkspacePrepareCandidate(baseParams(stateAfterFirst));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.outcome).toBe("no_op");
    expect(second.runlogEvents).toEqual([]);
  });

  it("reports a dirty-repository warning without blocking", () => {
    const state = stateWithWorkspace();
    const result = buildSharedWorkspacePrepareCandidate(baseParams(state, { isDirty: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("allocates the next generation after the final binding is released", () => {
    const state = stateWithWorkspace();
    const first = buildSharedWorkspacePrepareCandidate(baseParams(state));
    if (!first.ok) return;
    const stateAfterPrepare = stateWithWorkspace(first.managedWorkspaces, first.workspaceBindings);

    const release = buildSharedWorkspaceReleaseCandidate({
      state: stateAfterPrepare,
      workUnitId: "WU001",
      timestamp: T2,
      nextEventId: eventIdSequence(),
    });
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    const stateAfterRelease = stateWithWorkspace(release.managedWorkspaces, release.workspaceBindings);

    const reprepare = buildSharedWorkspacePrepareCandidate(baseParams(stateAfterRelease, { workUnitId: "WU002" }));
    expect(reprepare.ok).toBe(true);
    if (!reprepare.ok) return;
    expect(reprepare.outcome).toBe("created");
    expect(reprepare.workspace.generation).toBe(2);
    expect(reprepare.workspace.id).not.toBe(first.workspace.id);
  });

  it("the prior released shared workspace record remains immutable", () => {
    const state = stateWithWorkspace();
    const first = buildSharedWorkspacePrepareCandidate(baseParams(state));
    if (!first.ok) return;
    const stateAfterPrepare = stateWithWorkspace(first.managedWorkspaces, first.workspaceBindings);
    const release = buildSharedWorkspaceReleaseCandidate({
      state: stateAfterPrepare,
      workUnitId: "WU001",
      timestamp: T2,
      nextEventId: eventIdSequence(),
    });
    if (!release.ok) return;
    const releasedRecord = release.managedWorkspaces.find((w) => w.id === first.workspace.id)!;
    expect(releasedRecord.lifecycleStatus).toBe("released");
    expect(releasedRecord.generation).toBe(1);
    expect(releasedRecord.workspacePath).toBe(first.workspace.workspacePath);
  });
});

describe("buildSharedWorkspaceReleaseCandidate (M25 §12.1)", () => {
  it("releases only the selected binding, keeping the workspace ready while another binding remains active", () => {
    const state = stateWithWorkspace();
    const first = buildSharedWorkspacePrepareCandidate(baseParams(state));
    if (!first.ok) return;
    const stateAfterFirst = stateWithWorkspace(first.managedWorkspaces, first.workspaceBindings);
    const second = buildSharedWorkspacePrepareCandidate(baseParams(stateAfterFirst, { workUnitId: "WU002" }));
    if (!second.ok) return;
    const stateAfterBoth = stateWithWorkspace(second.managedWorkspaces, second.workspaceBindings);

    const release = buildSharedWorkspaceReleaseCandidate({
      state: stateAfterBoth,
      workUnitId: "WU001",
      timestamp: T2,
      nextEventId: eventIdSequence(),
    });
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    const workspace = release.managedWorkspaces.find((w) => w.id === second.workspace.id)!;
    expect(workspace.lifecycleStatus).toBe("ready");
    expect(release.runlogEvents.some((e) => e.type === "workspace.released")).toBe(false);
  });

  it("marks the workspace released only when the final binding is released", () => {
    const state = stateWithWorkspace();
    const first = buildSharedWorkspacePrepareCandidate(baseParams(state));
    if (!first.ok) return;
    const stateAfterFirst = stateWithWorkspace(first.managedWorkspaces, first.workspaceBindings);
    const release = buildSharedWorkspaceReleaseCandidate({
      state: stateAfterFirst,
      workUnitId: "WU001",
      timestamp: T2,
      nextEventId: eventIdSequence(),
    });
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    const workspace = release.managedWorkspaces.find((w) => w.id === first.workspace.id)!;
    expect(workspace.lifecycleStatus).toBe("released");
    expect(release.runlogEvents.some((e) => e.type === "workspace.released")).toBe(true);
  });

  it("is a no-op for a work unit with no active binding", () => {
    const state = stateWithWorkspace();
    const result = buildSharedWorkspaceReleaseCandidate({
      state,
      workUnitId: "WU999",
      timestamp: T1,
      nextEventId: eventIdSequence(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.runlogEvents).toEqual([]);
  });

  it("repeated release after successful finalization is a no-op", () => {
    const state = stateWithWorkspace();
    const first = buildSharedWorkspacePrepareCandidate(baseParams(state));
    if (!first.ok) return;
    const stateAfterFirst = stateWithWorkspace(first.managedWorkspaces, first.workspaceBindings);
    const release = buildSharedWorkspaceReleaseCandidate({
      state: stateAfterFirst,
      workUnitId: "WU001",
      timestamp: T2,
      nextEventId: eventIdSequence(),
    });
    if (!release.ok) return;
    const stateAfterRelease = stateWithWorkspace(release.managedWorkspaces, release.workspaceBindings);

    const secondRelease = buildSharedWorkspaceReleaseCandidate({
      state: stateAfterRelease,
      workUnitId: "WU001",
      timestamp: T2,
      nextEventId: eventIdSequence(),
    });
    expect(secondRelease.ok).toBe(true);
    if (!secondRelease.ok) return;
    expect(secondRelease.changed).toBe(false);
  });
});
