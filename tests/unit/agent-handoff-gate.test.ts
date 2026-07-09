import { describe, it, expect } from "vitest";
import { runAgentHandoffGate } from "../../src/workflow/agent-handoff-gate.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
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

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "M001",
    title: "M",
    objective: "O",
    status: "ready",
    workUnitIds: ["WU001"],
    ...overrides,
  };
}

function stateWithGraph(
  workUnits: WorkUnit[],
  milestones: Milestone[],
  dependencies: Dependency[] = [],
): StateModel {
  const state = buildInitialStateModel(T1);
  return { ...state, workGraph: { milestones, workUnits, dependencies } };
}

describe("runAgentHandoffGate", () => {
  it("passes for a valid ready work unit", () => {
    const wu = makeWorkUnit();
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    expect(() => runAgentHandoffGate(wu, milestone, state)).not.toThrow();
  });

  it("rejects a work unit that is not ready (exit code 1)", () => {
    const wu = makeWorkUnit({ status: "planned" });
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    try {
      runAgentHandoffGate(wu, milestone, state);
      expect.fail("expected AiqtError");
    } catch (err) {
      expect(err).toBeInstanceOf(AiqtError);
      expect((err as AiqtError).exitCode).toBe(ExitCode.ValidationFailed);
    }
  });

  it("rejects an empty title (exit code 1)", () => {
    const wu = makeWorkUnit({ title: "  " });
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    expect(() => runAgentHandoffGate(wu, milestone, state)).toThrow(AiqtError);
  });

  it("rejects missing scope (exit code 1)", () => {
    const wu = makeWorkUnit({ scope: [] });
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    try {
      runAgentHandoffGate(wu, milestone, state);
      expect.fail("expected AiqtError");
    } catch (err) {
      expect((err as AiqtError).exitCode).toBe(ExitCode.ValidationFailed);
    }
  });

  it("rejects missing acceptanceCriteria (exit code 1)", () => {
    const wu = makeWorkUnit({ acceptanceCriteria: [] });
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    try {
      runAgentHandoffGate(wu, milestone, state);
      expect.fail("expected AiqtError");
    } catch (err) {
      expect((err as AiqtError).exitCode).toBe(ExitCode.ValidationFailed);
    }
  });

  it("rejects missing validationCommands (exit code 1)", () => {
    const wu = makeWorkUnit({ validationCommands: [] });
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone]);
    try {
      runAgentHandoffGate(wu, milestone, state);
      expect.fail("expected AiqtError");
    } catch (err) {
      expect((err as AiqtError).exitCode).toBe(ExitCode.ValidationFailed);
    }
  });

  it("rejects a null/unknown milestone reference (exit code 3)", () => {
    const wu = makeWorkUnit();
    const state = stateWithGraph([wu], [makeMilestone()]);
    try {
      runAgentHandoffGate(wu, null, state);
      expect.fail("expected AiqtError");
    } catch (err) {
      expect((err as AiqtError).exitCode).toBe(ExitCode.InvalidInput);
    }
  });

  it("rejects an unknown dependency id reference (exit code 3)", () => {
    const wu = makeWorkUnit({ dependencies: ["DEP-999"] });
    const milestone = makeMilestone();
    const state = stateWithGraph([wu], [milestone], []);
    try {
      runAgentHandoffGate(wu, milestone, state);
      expect.fail("expected AiqtError");
    } catch (err) {
      expect((err as AiqtError).exitCode).toBe(ExitCode.InvalidInput);
    }
  });

  it("passes when dependency ids exist in the work graph", () => {
    const wu = makeWorkUnit({ dependencies: ["DEP-001"] });
    const milestone = makeMilestone();
    const dep: Dependency = {
      id: "DEP-001",
      fromId: "WU000",
      toId: "WU001",
      type: "blocks",
      reason: null,
    };
    const state = stateWithGraph([wu], [milestone], [dep]);
    expect(() => runAgentHandoffGate(wu, milestone, state)).not.toThrow();
  });
});
