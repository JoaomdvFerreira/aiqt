import { describe, it, expect } from "vitest";
import {
  deriveWorkspaceSeriesKey,
  deriveWorkspaceInstanceIdentity,
  derivePendingOperationId,
  resolveGenerationForSeries,
} from "../../src/workspaces/workspace-identity.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("deriveWorkspaceSeriesKey (M25 §6.1)", () => {
  it("is deterministic for shared mode", () => {
    const input = {
      mode: "shared" as const,
      projectId: "P1",
      providerId: "shared-repository@1" as const,
      assignmentKey: "team-a",
      implementationRoot: "/repo",
    };
    expect(deriveWorkspaceSeriesKey(input)).toBe(deriveWorkspaceSeriesKey({ ...input }));
  });

  it("is deterministic for isolated mode", () => {
    const input = {
      mode: "isolated" as const,
      projectId: "P1",
      providerId: "git-worktree@1" as const,
      assignmentKey: "wu-1",
      baseCommit: SHA_A,
    };
    expect(deriveWorkspaceSeriesKey(input)).toBe(deriveWorkspaceSeriesKey({ ...input }));
  });

  it("different assignment keys produce different series keys", () => {
    const a = deriveWorkspaceSeriesKey({
      mode: "isolated",
      projectId: "P1",
      providerId: "git-worktree@1",
      assignmentKey: "wu-1",
      baseCommit: SHA_A,
    });
    const b = deriveWorkspaceSeriesKey({
      mode: "isolated",
      projectId: "P1",
      providerId: "git-worktree@1",
      assignmentKey: "wu-2",
      baseCommit: SHA_A,
    });
    expect(a).not.toBe(b);
  });

  it("different base commits produce different isolated series keys", () => {
    const a = deriveWorkspaceSeriesKey({
      mode: "isolated",
      projectId: "P1",
      providerId: "git-worktree@1",
      assignmentKey: "wu-1",
      baseCommit: SHA_A,
    });
    const b = deriveWorkspaceSeriesKey({
      mode: "isolated",
      projectId: "P1",
      providerId: "git-worktree@1",
      assignmentKey: "wu-1",
      baseCommit: SHA_B,
    });
    expect(a).not.toBe(b);
  });

  it("different projects do not collide", () => {
    const a = deriveWorkspaceSeriesKey({
      mode: "shared",
      projectId: "P1",
      providerId: "shared-repository@1",
      assignmentKey: "team-a",
      implementationRoot: "/repo",
    });
    const b = deriveWorkspaceSeriesKey({
      mode: "shared",
      projectId: "P2",
      providerId: "shared-repository@1",
      assignmentKey: "team-a",
      implementationRoot: "/repo",
    });
    expect(a).not.toBe(b);
  });

  it("prevents naive delimiter-concatenation ambiguity across tuple elements", () => {
    const a = deriveWorkspaceSeriesKey({
      mode: "isolated",
      projectId: "P1",
      providerId: "git-worktree@1",
      assignmentKey: "ab",
      baseCommit: SHA_A,
    });
    const b = deriveWorkspaceSeriesKey({
      mode: "isolated",
      projectId: "P1a",
      providerId: "git-worktree@1" as const,
      assignmentKey: "b",
      baseCommit: SHA_A,
    });
    expect(a).not.toBe(b);
  });
});

describe("deriveWorkspaceInstanceIdentity (M25 §6.3)", () => {
  it("is deterministic for the same series+generation", () => {
    expect(deriveWorkspaceInstanceIdentity("series-key", 1)).toBe(deriveWorkspaceInstanceIdentity("series-key", 1));
  });

  it("differs across generations for the same series", () => {
    expect(deriveWorkspaceInstanceIdentity("series-key", 1)).not.toBe(
      deriveWorkspaceInstanceIdentity("series-key", 2),
    );
  });

  it("differs across series for the same generation", () => {
    expect(deriveWorkspaceInstanceIdentity("series-a", 1)).not.toBe(deriveWorkspaceInstanceIdentity("series-b", 1));
  });
});

describe("derivePendingOperationId (M25 §5.3)", () => {
  it("is deterministic and idempotent for the same defining tuple", () => {
    const input = { type: "prepare" as const, workUnitId: "WU001", workspaceSeriesKey: "series-key", generation: 1 };
    expect(derivePendingOperationId(input)).toBe(derivePendingOperationId({ ...input }));
  });

  it("differs between prepare and release for the same tuple otherwise", () => {
    const base = { workUnitId: "WU001", workspaceSeriesKey: "series-key", generation: 1 };
    expect(derivePendingOperationId({ type: "prepare", ...base })).not.toBe(
      derivePendingOperationId({ type: "release", ...base }),
    );
  });
});

describe("resolveGenerationForSeries (M25 §6.2)", () => {
  it("allocates generation 1 with no history", () => {
    expect(resolveGenerationForSeries([], [])).toEqual({ action: "allocate", generation: 1 });
  });

  it("reuses the active workspace's generation without incrementing", () => {
    const result = resolveGenerationForSeries([{ id: "WS-001", generation: 1, lifecycleStatus: "ready" }], []);
    expect(result).toEqual({ action: "reuse_active_workspace", generation: 1, existingWorkspaceId: "WS-001" });
  });

  it("reuses a pending prepare's reserved generation without incrementing", () => {
    const result = resolveGenerationForSeries([], [{ id: "op-1", generation: 2 }]);
    expect(result).toEqual({ action: "reuse_pending_generation", generation: 2, existingPendingOperationId: "op-1" });
  });

  it("allocates generation+1 after only released history", () => {
    const result = resolveGenerationForSeries(
      [
        { id: "WS-001", generation: 1, lifecycleStatus: "released" },
        { id: "WS-002", generation: 2, lifecycleStatus: "released" },
      ],
      [],
    );
    expect(result).toEqual({ action: "allocate", generation: 3 });
  });

  it("prefers an active workspace over pending or released history", () => {
    const result = resolveGenerationForSeries(
      [
        { id: "WS-001", generation: 1, lifecycleStatus: "released" },
        { id: "WS-002", generation: 2, lifecycleStatus: "ready" },
      ],
      [{ id: "op-1", generation: 3 }],
    );
    expect(result.action).toBe("reuse_active_workspace");
    expect(result.generation).toBe(2);
  });

  it("does not repair a missing historical generation gap", () => {
    const result = resolveGenerationForSeries(
      [
        { id: "WS-001", generation: 1, lifecycleStatus: "released" },
        { id: "WS-003", generation: 3, lifecycleStatus: "released" },
      ],
      [],
    );
    expect(result).toEqual({ action: "allocate", generation: 4 });
  });
});
