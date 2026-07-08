import { describe, it, expect } from "vitest";
import { buildWorkGraphFromPlanInput } from "../../src/services/planning-service.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import type { PlanInput } from "../../src/schema/plan-input.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

function baseWorkUnit(overrides: Partial<PlanInput["workUnits"][number]> = {}) {
  return {
    clientKey: "wu1",
    milestoneClientKey: "m1",
    title: "WU1",
    objective: "Objective",
    scope: ["scope"],
    outOfScope: ["out"],
    acceptanceCriteria: ["criterion"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    ...overrides,
  };
}

function basePlan(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    milestones: [{ clientKey: "m1", title: "M1", objective: "Obj" }],
    workUnits: [baseWorkUnit()],
    dependencies: [],
    ...overrides,
  };
}

describe("buildWorkGraphFromPlanInput: ID generation", () => {
  it("assigns M001/WU001/DEP-001 style ids in input order", () => {
    const plan = basePlan({
      milestones: [
        { clientKey: "m1", title: "M1", objective: "O1" },
        { clientKey: "m2", title: "M2", objective: "O2" },
      ],
      workUnits: [
        baseWorkUnit({ clientKey: "wu1", milestoneClientKey: "m1" }),
        baseWorkUnit({ clientKey: "wu2", milestoneClientKey: "m2" }),
      ],
      dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" }],
    });
    const result = buildWorkGraphFromPlanInput(plan, T1);
    expect(result.milestones.map((m) => m.id)).toEqual(["M001", "M002"]);
    expect(result.workUnits.map((wu) => wu.id)).toEqual(["WU001", "WU002"]);
    expect(result.dependencies.map((d) => d.id)).toEqual(["DEP-001"]);
  });

  it("stamps createdAt/updatedAt on work units using the given timestamp", () => {
    const result = buildWorkGraphFromPlanInput(basePlan(), T1);
    expect(result.workUnits[0].createdAt).toBe(T1);
    expect(result.workUnits[0].updatedAt).toBe(T1);
  });
});

describe("buildWorkGraphFromPlanInput: readiness and status", () => {
  it("marks a work unit with no incoming blocking dependency as ready", () => {
    const result = buildWorkGraphFromPlanInput(basePlan(), T1);
    expect(result.workUnits[0].status).toBe("ready");
    expect(result.readyWorkUnitId).toBe("WU001");
    expect(result.readyWorkUnitCount).toBe(1);
    expect(result.plannedWorkUnitCount).toBe(0);
  });

  it("marks a work unit with an incoming blocks dependency as planned", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2" }),
      ],
      dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" }],
    });
    const result = buildWorkGraphFromPlanInput(plan, T1);
    expect(result.workUnits[0].status).toBe("ready");
    expect(result.workUnits[1].status).toBe("planned");
    expect(result.readyWorkUnitId).toBe("WU001");
  });

  it("does not let a relates_to dependency affect readiness", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2" }),
      ],
      dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "relates_to" }],
    });
    const result = buildWorkGraphFromPlanInput(plan, T1);
    expect(result.workUnits[1].status).toBe("ready");
  });

  it("gives a milestone status ready when a child work unit is ready", () => {
    const result = buildWorkGraphFromPlanInput(basePlan(), T1);
    expect(result.milestones[0].status).toBe("ready");
  });

  it("populates milestone.workUnitIds using canonical work-unit ids in input order", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2" }),
      ],
    });
    const result = buildWorkGraphFromPlanInput(plan, T1);
    expect(result.milestones[0].workUnitIds).toEqual(["WU001", "WU002"]);
  });

  it("populates workUnit.dependencies with incoming dependency ids", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2" }),
      ],
      dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" }],
    });
    const result = buildWorkGraphFromPlanInput(plan, T1);
    expect(result.workUnits[0].dependencies).toEqual([]);
    expect(result.workUnits[1].dependencies).toEqual(["DEP-001"]);
  });

  it("selects the first ready work unit by input order", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2", milestoneClientKey: "m1" }),
      ],
      dependencies: [{ fromClientKey: "wu2", toClientKey: "wu1", type: "blocks" }],
    });
    // wu1 has an incoming block from wu2, so wu1 is planned; wu2 has no
    // incoming block, so wu2 is ready and should be selected.
    const result = buildWorkGraphFromPlanInput(plan, T1);
    expect(result.readyWorkUnitId).toBe("WU002");
    expect(result.currentMilestoneId).toBe("M001");
  });
});

describe("buildWorkGraphFromPlanInput: validation failures (no mutation, exit 3)", () => {
  it("rejects a duplicate milestone clientKey", () => {
    const plan = basePlan({
      milestones: [
        { clientKey: "m1", title: "M1", objective: "O1" },
        { clientKey: "m1", title: "M1 dup", objective: "O2" },
      ],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("rejects a duplicate workUnit clientKey", () => {
    const plan = basePlan({
      workUnits: [baseWorkUnit({ clientKey: "wu1" }), baseWorkUnit({ clientKey: "wu1" })],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("rejects an unknown milestoneClientKey reference", () => {
    const plan = basePlan({
      workUnits: [baseWorkUnit({ milestoneClientKey: "does-not-exist" })],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("rejects an unknown dependency clientKey reference", () => {
    const plan = basePlan({
      dependencies: [{ fromClientKey: "wu1", toClientKey: "missing", type: "blocks" }],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("rejects an empty milestone (no referencing work units)", () => {
    const plan = basePlan({
      milestones: [
        { clientKey: "m1", title: "M1", objective: "O1" },
        { clientKey: "m2", title: "M2", objective: "O2" },
      ],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("rejects a self-dependency", () => {
    const plan = basePlan({
      dependencies: [{ fromClientKey: "wu1", toClientKey: "wu1", type: "blocks" }],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("rejects a duplicate dependency (same from, to, type)", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2" }),
      ],
      dependencies: [
        { fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" },
        { fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" },
      ],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("rejects a circular blocking dependency", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2" }),
      ],
      dependencies: [
        { fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" },
        { fromClientKey: "wu2", toClientKey: "wu1", type: "requires" },
      ],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).toThrow(AiqtError);
  });

  it("does not throw for a circular relates_to dependency (ignored for cycle detection)", () => {
    const plan = basePlan({
      workUnits: [
        baseWorkUnit({ clientKey: "wu1" }),
        baseWorkUnit({ clientKey: "wu2" }),
      ],
      dependencies: [
        { fromClientKey: "wu1", toClientKey: "wu2", type: "relates_to" },
        { fromClientKey: "wu2", toClientKey: "wu1", type: "relates_to" },
      ],
    });
    expect(() => buildWorkGraphFromPlanInput(plan, T1)).not.toThrow();
  });
});
