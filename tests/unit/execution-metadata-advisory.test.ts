import { describe, it, expect } from "vitest";
import {
  buildExecutionMetadataAdvisory,
  renderExecutionMetadataAdvisorySection,
} from "../../src/workflow/execution-metadata-advisory.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
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

function stateWith(workUnits: WorkUnit[]): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workGraph: { milestones: [], workUnits, dependencies: [] } };
}

describe("buildExecutionMetadataAdvisory (M24 §13)", () => {
  it("reports metadataDeclared: false and workspace mode unknown for a historical Work Unit", () => {
    const wu = workUnit("WU001");
    const advisory = buildExecutionMetadataAdvisory(wu, stateWith([wu]));
    expect(advisory.metadataDeclared).toBe(false);
    expect(advisory.workspace.mode).toBe("unknown");
    expect(advisory.parallel.mode).toBe("serialized");
  });

  it("reports declared workspace/parallel metadata when present", () => {
    const wu = workUnit("WU001", {
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
        parallelPolicy: {
          mode: "eligible_if_no_conflict",
          concurrencyGroup: "g1",
          resourceClaims: [{ domain: "path", key: "src", access: "write" }],
        },
      },
    });
    const advisory = buildExecutionMetadataAdvisory(wu, stateWith([wu]));
    expect(advisory.metadataDeclared).toBe(true);
    expect(advisory.workspace.mode).toBe("isolated");
    expect(advisory.workspace.assignmentKey).toBe("wu-1");
    expect(advisory.parallel.concurrencyGroup).toBe("g1");
    expect(advisory.parallel.resourceClaimCount).toBe(1);
  });

  it("is compatibleWithActiveWork: true when there is no active work at all", () => {
    const wu = workUnit("WU001");
    const advisory = buildExecutionMetadataAdvisory(wu, stateWith([wu]));
    expect(advisory.parallel.compatibleWithActiveWork).toBe(true);
    expect(advisory.parallel.advisoryReasons).toEqual([]);
  });

  it("is compatibleWithActiveWork: false with advisory reasons when it conflicts with an active work unit", () => {
    const wu = workUnit("WU001", {
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "dup", access: "read_write" },
        parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
      },
    });
    const active = workUnit("WU002", {
      status: "in_progress",
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "dup", access: "read_write" },
        parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
      },
    });
    const advisory = buildExecutionMetadataAdvisory(wu, stateWith([wu, active]));
    expect(advisory.parallel.compatibleWithActiveWork).toBe(false);
    expect(advisory.parallel.advisoryReasons).toContain("isolated_assignment_key_reused");
  });

  it("never considers the work unit itself as an active conflict source", () => {
    const wu = workUnit("WU001", { status: "in_progress" });
    const advisory = buildExecutionMetadataAdvisory(wu, stateWith([wu]));
    expect(advisory.parallel.compatibleWithActiveWork).toBe(true);
  });
});

describe("renderExecutionMetadataAdvisorySection (M24 §13)", () => {
  it("never includes a concrete physical path or provider identifier (only the disclaimer denying them)", () => {
    const wu = workUnit("WU001", {
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
        parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
      },
    });
    const text = renderExecutionMetadataAdvisorySection(buildExecutionMetadataAdvisory(wu, stateWith([wu])));
    expect(text).not.toMatch(/C:\\|\/home\/|\/Users\/|https?:\/\//i);
    expect(text).toContain("does not authorize creating a branch, worktree, or any other execution environment");
  });

  it("uses advisory wording and never claims a workspace exists", () => {
    const wu = workUnit("WU001");
    const text = renderExecutionMetadataAdvisorySection(buildExecutionMetadataAdvisory(wu, stateWith([wu])));
    expect(text).toContain("Advisory metadata only");
    expect(text).toContain("no physical workspace has been created");
    expect(text).toContain("does not authorize creating a branch, worktree");
  });

  it("includes a missing-metadata note when no M24 metadata is declared", () => {
    const wu = workUnit("WU001");
    const text = renderExecutionMetadataAdvisorySection(buildExecutionMetadataAdvisory(wu, stateWith([wu])));
    expect(text).toContain("No M24 execution metadata is declared");
    expect(text).toContain("serialized");
  });

  it("omits the missing-metadata note when metadata is declared", () => {
    const wu = workUnit("WU001", {
      executionMetadata: {
        workspaceAssignment: { mode: "none", access: "read_only" },
        parallelPolicy: { mode: "serialized", resourceClaims: [] },
      },
    });
    const text = renderExecutionMetadataAdvisorySection(buildExecutionMetadataAdvisory(wu, stateWith([wu])));
    expect(text).not.toContain("No M24 execution metadata is declared");
  });

  it("includes the section heading", () => {
    const wu = workUnit("WU001");
    const text = renderExecutionMetadataAdvisorySection(buildExecutionMetadataAdvisory(wu, stateWith([wu])));
    expect(text).toContain("Workspace and Parallel Execution Advisory");
  });
});
