import { describe, it, expect } from "vitest";
import {
  wouldIntroduceCycle,
  wouldInvalidateActiveExecution,
  recalculateReadinessAfterDependencyUpdate,
} from "../../src/workflow/dependency-update-transition.js";
import type { WorkUnit, WorkUnitStatus } from "../../src/schema/work-unit.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

function wu(id: string, status: WorkUnitStatus): WorkUnit {
  return {
    id,
    milestoneId: "M001",
    title: id,
    objective: "o",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status,
    dependencies: [],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function dep(id: string, fromId: string, toId: string, type: Dependency["type"]): Dependency {
  return { id, fromId, toId, type, reason: null };
}

describe("wouldIntroduceCycle", () => {
  it("detects a cycle introduced by tightening relates_to into blocks", () => {
    const workUnits = [wu("WU001", "ready"), wu("WU002", "ready")];
    const dependencies = [
      dep("DEP-001", "WU001", "WU002", "blocks"),
      dep("DEP-002", "WU002", "WU001", "relates_to"),
    ];
    expect(wouldIntroduceCycle(workUnits, dependencies, "DEP-002", "blocks")).toBe(true);
  });

  it("returns false when no cycle would result", () => {
    const workUnits = [wu("WU001", "ready"), wu("WU002", "ready"), wu("WU003", "ready")];
    const dependencies = [
      dep("DEP-001", "WU001", "WU002", "blocks"),
      dep("DEP-002", "WU002", "WU003", "relates_to"),
    ];
    expect(wouldIntroduceCycle(workUnits, dependencies, "DEP-002", "blocks")).toBe(false);
  });

  it("relates_to can never introduce a cycle", () => {
    const workUnits = [wu("WU001", "ready"), wu("WU002", "ready")];
    const dependencies = [
      dep("DEP-001", "WU001", "WU002", "blocks"),
      dep("DEP-002", "WU002", "WU001", "blocks"),
    ];
    // Already-cyclic canonical state aside, loosening to relates_to is never itself cycle-introducing.
    expect(wouldIntroduceCycle(workUnits, dependencies, "DEP-002", "relates_to")).toBe(false);
  });
});

describe("wouldInvalidateActiveExecution", () => {
  it("blocks tightening a dependency onto an in_progress work unit whose source is not done", () => {
    const workUnits = [wu("WU001", "ready"), wu("WU002", "in_progress")];
    const dependency = dep("DEP-001", "WU001", "WU002", "relates_to");
    expect(wouldInvalidateActiveExecution(workUnits, dependency, "blocks")).toBe(true);
  });

  it("allows the update when the source work unit is already done", () => {
    const workUnits = [wu("WU001", "done"), wu("WU002", "in_progress")];
    const dependency = dep("DEP-001", "WU001", "WU002", "relates_to");
    expect(wouldInvalidateActiveExecution(workUnits, dependency, "blocks")).toBe(false);
  });

  it("allows the update when the target work unit is not in_progress", () => {
    const workUnits = [wu("WU001", "ready"), wu("WU002", "planned")];
    const dependency = dep("DEP-001", "WU001", "WU002", "relates_to");
    expect(wouldInvalidateActiveExecution(workUnits, dependency, "blocks")).toBe(false);
  });

  it("relates_to updates never invalidate active execution", () => {
    const workUnits = [wu("WU001", "ready"), wu("WU002", "in_progress")];
    const dependency = dep("DEP-001", "WU001", "WU002", "blocks");
    expect(wouldInvalidateActiveExecution(workUnits, dependency, "relates_to")).toBe(false);
  });
});

describe("recalculateReadinessAfterDependencyUpdate", () => {
  it("demotes a ready work unit to planned when its dependency tightens and the source is not done", () => {
    const workUnits = [wu("WU001", "ready"), wu("WU002", "ready")];
    const dependencies = [dep("DEP-001", "WU002", "WU001", "blocks")];
    const result = recalculateReadinessAfterDependencyUpdate(
      workUnits,
      dependencies,
      "2026-07-14T01:00:00.000Z",
    );
    expect(result.workUnits.find((w) => w.id === "WU001")?.status).toBe("planned");
    expect(result.newlyPlannedWorkUnitIds).toEqual(["WU001"]);
    expect(result.newlyReadyWorkUnitIds).toEqual([]);
  });

  it("promotes a planned work unit to ready when its dependency loosens", () => {
    const workUnits = [wu("WU001", "planned"), wu("WU002", "ready")];
    const dependencies = [dep("DEP-001", "WU002", "WU001", "relates_to")];
    const result = recalculateReadinessAfterDependencyUpdate(
      workUnits,
      dependencies,
      "2026-07-14T01:00:00.000Z",
    );
    expect(result.workUnits.find((w) => w.id === "WU001")?.status).toBe("ready");
    expect(result.newlyReadyWorkUnitIds).toEqual(["WU001"]);
  });

  it("never touches done, in_progress, needs_review, cancelled, or replanned work units", () => {
    const workUnits = [
      wu("WU001", "done"),
      wu("WU002", "in_progress"),
      wu("WU003", "needs_review"),
      wu("WU004", "cancelled"),
      wu("WU005", "replanned"),
    ];
    const dependencies: Dependency[] = [];
    const result = recalculateReadinessAfterDependencyUpdate(
      workUnits,
      dependencies,
      "2026-07-14T01:00:00.000Z",
    );
    expect(result.workUnits).toEqual(workUnits);
    expect(result.newlyReadyWorkUnitIds).toEqual([]);
    expect(result.newlyPlannedWorkUnitIds).toEqual([]);
  });
});
