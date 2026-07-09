import { describe, it, expect } from "vitest";
import { recalculateDependencyReadiness } from "../../src/workflow/dependency-readiness.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

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
    status: "planned",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function dep(overrides: Partial<Dependency> = {}): Dependency {
  return { id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", reason: null, ...overrides };
}

describe("recalculateDependencyReadiness", () => {
  it("promotes a planned work unit to ready when its blocking source is done", () => {
    const workUnits = [wu({ id: "WU001", status: "done" }), wu({ id: "WU002", status: "planned" })];
    const deps = [dep({ fromId: "WU001", toId: "WU002", type: "blocks" })];
    const result = recalculateDependencyReadiness(workUnits, deps, T2);
    expect(result.newlyReadyWorkUnitIds).toEqual(["WU002"]);
    expect(result.workUnits.find((w) => w.id === "WU002")?.status).toBe("ready");
    expect(result.workUnits.find((w) => w.id === "WU002")?.updatedAt).toBe(T2);
  });

  it("does not promote a work unit whose source is not yet done", () => {
    const workUnits = [wu({ id: "WU001", status: "in_progress" }), wu({ id: "WU002", status: "planned" })];
    const deps = [dep({ fromId: "WU001", toId: "WU002", type: "blocks" })];
    const result = recalculateDependencyReadiness(workUnits, deps, T2);
    expect(result.newlyReadyWorkUnitIds).toEqual([]);
    expect(result.workUnits.find((w) => w.id === "WU002")?.status).toBe("planned");
  });

  it("requires ALL blocking dependencies to be satisfied", () => {
    const workUnits = [
      wu({ id: "WU001", status: "done" }),
      wu({ id: "WU002", status: "planned" }),
      wu({ id: "WU003", status: "planned" }),
    ];
    const deps = [
      dep({ id: "DEP-001", fromId: "WU001", toId: "WU003", type: "blocks" }),
      dep({ id: "DEP-002", fromId: "WU002", toId: "WU003", type: "requires" }),
    ];
    const result = recalculateDependencyReadiness(workUnits, deps, T2);
    expect(result.newlyReadyWorkUnitIds).toEqual([]);
  });

  it("ignores relates_to dependencies for readiness", () => {
    const workUnits = [wu({ id: "WU001", status: "planned" }), wu({ id: "WU002", status: "planned" })];
    const deps = [dep({ fromId: "WU002", toId: "WU001", type: "relates_to" })];
    const result = recalculateDependencyReadiness(workUnits, deps, T2);
    // WU001 has no blocking dependency at all -> stays planned (not auto-promoted
    // just because its only incoming edge is informational).
    expect(result.workUnits.find((w) => w.id === "WU001")?.status).toBe("planned");
  });

  it("does not touch non-planned work units", () => {
    const workUnits = [
      wu({ id: "WU001", status: "done" }),
      wu({ id: "WU002", status: "ready" }),
      wu({ id: "WU003", status: "in_progress" }),
      wu({ id: "WU004", status: "needs_review" }),
    ];
    const result = recalculateDependencyReadiness(workUnits, [], T2);
    expect(result.newlyReadyWorkUnitIds).toEqual([]);
    expect(result.workUnits).toEqual(workUnits);
  });

  it("processes newly ready work units in stored order", () => {
    const workUnits = [
      wu({ id: "WU001", status: "done" }),
      wu({ id: "WU002", status: "planned" }),
      wu({ id: "WU003", status: "planned" }),
    ];
    const deps = [
      dep({ id: "DEP-001", fromId: "WU001", toId: "WU003", type: "blocks" }),
      dep({ id: "DEP-002", fromId: "WU001", toId: "WU002", type: "blocks" }),
    ];
    const result = recalculateDependencyReadiness(workUnits, deps, T2);
    expect(result.newlyReadyWorkUnitIds).toEqual(["WU002", "WU003"]);
  });
});
