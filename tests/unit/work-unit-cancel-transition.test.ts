import { describe, it, expect } from "vitest";
import {
  computeWorkUnitCancelStatus,
  applyWorkUnitCancelTransition,
} from "../../src/workflow/work-unit-cancel-transition.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function wu(overrides: Partial<WorkUnit> = {}): WorkUnit {
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
    status: "in_progress",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function dep(overrides: Partial<Dependency> = {}): Dependency {
  return { id: "DEP-001", fromId: "WU000", toId: "WU001", type: "blocks", reason: null, ...overrides };
}

describe("computeWorkUnitCancelStatus", () => {
  it("reverts to ready when there are no incoming blocking dependencies", () => {
    expect(computeWorkUnitCancelStatus("WU001", [], [wu({ status: "in_progress" })])).toBe("ready");
  });

  it("reverts to ready when all incoming blocking dependency sources are done", () => {
    const workUnits = [wu({ id: "WU000", status: "done" }), wu({ id: "WU001", status: "in_progress" })];
    expect(computeWorkUnitCancelStatus("WU001", [dep()], workUnits)).toBe("ready");
  });

  it("reverts to planned when an incoming blocking dependency source is not done", () => {
    const workUnits = [wu({ id: "WU000", status: "ready" }), wu({ id: "WU001", status: "in_progress" })];
    expect(computeWorkUnitCancelStatus("WU001", [dep()], workUnits)).toBe("planned");
  });

  it("ignores relates_to dependencies when deciding the restored status", () => {
    const workUnits = [wu({ id: "WU000", status: "ready" }), wu({ id: "WU001", status: "in_progress" })];
    const relatesTo = dep({ type: "relates_to" });
    expect(computeWorkUnitCancelStatus("WU001", [relatesTo], workUnits)).toBe("ready");
  });
});

describe("applyWorkUnitCancelTransition", () => {
  function baseState(overrides: Partial<StateModel> = {}): StateModel {
    return {
      version: "1.0.0",
      projectStatus: "in_progress",
      currentMilestoneId: "M001",
      currentWorkUnitId: "WU001",
      workGraph: {
        milestones: [{ id: "M001", title: "m", objective: "o", status: "in_progress", workUnitIds: ["WU001"] }],
        workUnits: [wu({ status: "in_progress" })],
        dependencies: [],
      },
      checkpoints: [],
      lastAgentPacket: null,
      nextRecommendedCommand: "aiqt checkpoint",
      lastUpdatedAt: T1,
      ...overrides,
    };
  }

  it("restores the cancelled work unit to ready and stamps updatedAt", () => {
    const state = baseState();
    const result = applyWorkUnitCancelTransition(state, "WU001", T2);
    const restored = result.workUnits.find((w) => w.id === "WU001");
    expect(restored?.status).toBe("ready");
    expect(restored?.updatedAt).toBe(T2);
    expect(result.restoredStatus).toBe("ready");
  });

  it("recomputes milestone status from the restored children", () => {
    const state = baseState();
    const result = applyWorkUnitCancelTransition(state, "WU001", T2);
    expect(result.milestones.find((m) => m.id === "M001")?.status).toBe("ready");
  });

  it("leaves every other work unit untouched", () => {
    const state = baseState({
      workGraph: {
        milestones: [
          { id: "M001", title: "m", objective: "o", status: "in_progress", workUnitIds: ["WU001", "WU002"] },
        ],
        workUnits: [wu({ status: "in_progress" }), wu({ id: "WU002", status: "planned" })],
        dependencies: [],
      },
    });
    const result = applyWorkUnitCancelTransition(state, "WU001", T2);
    expect(result.workUnits.find((w) => w.id === "WU002")).toEqual(
      state.workGraph.workUnits.find((w) => w.id === "WU002"),
    );
  });
});
