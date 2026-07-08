import { describe, it, expect } from "vitest";
import { PlanInputSchema } from "../../src/schema/plan-input.schema.js";

function validMinimalPlan() {
  return {
    milestones: [{ clientKey: "m1", title: "M1", objective: "Obj" }],
    workUnits: [
      {
        clientKey: "wu1",
        milestoneClientKey: "m1",
        title: "WU1",
        objective: "Obj",
        scope: ["s"],
        outOfScope: ["o"],
        acceptanceCriteria: ["a"],
        validationCommands: ["pnpm test"],
      },
    ],
  };
}

describe("PlanInputSchema", () => {
  it("validates a valid minimal plan, defaulting optional fields", () => {
    const parsed = PlanInputSchema.safeParse(validMinimalPlan());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dependencies).toEqual([]);
      expect(parsed.data.workUnits[0].agentContextRefs).toEqual([]);
      expect(parsed.data.workUnits[0].suggestedFiles).toEqual([]);
    }
  });

  it("rejects a missing milestones array", () => {
    const plan = validMinimalPlan() as Record<string, unknown>;
    delete plan.milestones;
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects an empty milestones array", () => {
    const plan = { ...validMinimalPlan(), milestones: [] };
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects an empty workUnits array", () => {
    const plan = { ...validMinimalPlan(), workUnits: [] };
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a work unit missing milestoneClientKey", () => {
    const plan = validMinimalPlan();
    delete (plan.workUnits[0] as Record<string, unknown>).milestoneClientKey;
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const plan = { ...validMinimalPlan(), extra: true };
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects unknown nested keys in a milestone", () => {
    const plan = validMinimalPlan();
    (plan.milestones[0] as Record<string, unknown>).extra = true;
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects unknown nested keys in a work unit", () => {
    const plan = validMinimalPlan();
    (plan.workUnits[0] as Record<string, unknown>).extra = true;
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects an invalid dependency type enum value", () => {
    const plan = {
      ...validMinimalPlan(),
      dependencies: [{ fromClientKey: "wu1", toClientKey: "wu1", type: "depends_on" }],
    };
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a work unit with an empty scope array", () => {
    const plan = validMinimalPlan();
    (plan.workUnits[0] as { scope: string[] }).scope = [];
    expect(PlanInputSchema.safeParse(plan).success).toBe(false);
  });
});
