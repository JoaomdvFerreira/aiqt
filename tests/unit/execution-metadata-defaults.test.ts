import { describe, it, expect } from "vitest";
import {
  deriveEffectiveExecutionMetadata,
  isTerminalWorkUnitStatus,
  isActiveOccupancyStatus,
} from "../../src/workflow/execution-metadata-defaults.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

function baseWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
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

describe("deriveEffectiveExecutionMetadata (M24 §7 Conservative Historical Defaults)", () => {
  it("derives unknown/serialized/never-eligible for a Work Unit with no executionMetadata", () => {
    const result = deriveEffectiveExecutionMetadata(baseWorkUnit());
    expect(result.metadataStatus).toBe("missing");
    expect(result.workspaceAssignment.mode).toBe("unknown");
    expect(result.parallelPolicy.mode).toBe("serialized");
    expect(result.automaticEligibilityPossible).toBe(false);
  });

  it("never writes the derived default back onto the Work Unit (pure projection)", () => {
    const wu = baseWorkUnit();
    deriveEffectiveExecutionMetadata(wu);
    expect(wu.executionMetadata).toBeUndefined();
  });

  it("derives serialized when parallelPolicy is present but omits mode-affecting fields other than default", () => {
    const wu = baseWorkUnit({
      executionMetadata: { workspaceAssignment: { mode: "none", access: "read_only" } },
    });
    const result = deriveEffectiveExecutionMetadata(wu);
    expect(result.metadataStatus).toBe("complete");
    expect(result.parallelPolicy.mode).toBe("serialized");
    expect(result.workspaceAssignment.mode).toBe("none");
    expect(result.automaticEligibilityPossible).toBe(false);
  });

  it("reflects eligible_if_no_conflict as automatic-eligibility-possible", () => {
    const wu = baseWorkUnit({
      executionMetadata: {
        workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
        parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
      },
    });
    const result = deriveEffectiveExecutionMetadata(wu);
    expect(result.automaticEligibilityPossible).toBe(true);
    expect(result.workspaceAssignment.assignmentKey).toBe("wu-1");
  });

  it("manual_review is never automatic-eligibility-possible", () => {
    const wu = baseWorkUnit({
      executionMetadata: { parallelPolicy: { mode: "manual_review", resourceClaims: [] } },
    });
    expect(deriveEffectiveExecutionMetadata(wu).automaticEligibilityPossible).toBe(false);
  });

  it("reports metadataStatus 'invalid' for a structurally inconsistent executionMetadata value (defense in depth)", () => {
    // Bypasses the WorkUnitSchema gate deliberately, simulating hand-edited
    // canonical state that never should have passed schema validation.
    const wu = baseWorkUnit({
      executionMetadata: {
        workspaceAssignment: { mode: "none", access: "read_only" },
        parallelPolicy: {
          mode: "serialized",
          resourceClaims: [{ domain: "repository", key: "project", access: "exclusive" }],
        },
      } as WorkUnit["executionMetadata"],
    });
    const result = deriveEffectiveExecutionMetadata(wu);
    expect(result.metadataStatus).toBe("invalid");
    expect(result.workspaceAssignment.mode).toBe("unknown");
    expect(result.automaticEligibilityPossible).toBe(false);
  });
});

describe("terminal/active-occupancy status helpers (M24 §8.2 Gate D derivation)", () => {
  it("treats done, replanned, and cancelled as terminal", () => {
    expect(isTerminalWorkUnitStatus("done")).toBe(true);
    expect(isTerminalWorkUnitStatus("replanned")).toBe(true);
    expect(isTerminalWorkUnitStatus("cancelled")).toBe(true);
  });

  it("treats ready, planned, in_progress, needs_review as non-terminal", () => {
    expect(isTerminalWorkUnitStatus("ready")).toBe(false);
    expect(isTerminalWorkUnitStatus("planned")).toBe(false);
    expect(isTerminalWorkUnitStatus("in_progress")).toBe(false);
    expect(isTerminalWorkUnitStatus("needs_review")).toBe(false);
  });

  it("treats in_progress and needs_review as active-occupancy statuses", () => {
    expect(isActiveOccupancyStatus("in_progress")).toBe(true);
    expect(isActiveOccupancyStatus("needs_review")).toBe(true);
  });

  it("treats every other status as non-occupying", () => {
    for (const status of ["ready", "planned", "done", "replanned", "cancelled"] as const) {
      expect(isActiveOccupancyStatus(status)).toBe(false);
    }
  });
});
