import { describe, it, expect } from "vitest";
import {
  applyCheckpointWorkUnitTransition,
  computeMilestoneStatus,
  recalculateMilestoneStatuses,
  computeProjectStatus,
} from "../../src/workflow/checkpoint-status-transitions.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";

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

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "in_progress", workUnitIds: ["WU001"], ...overrides };
}

describe("applyCheckpointWorkUnitTransition", () => {
  it("moves only the selected work unit to the final status, bumping updatedAt", () => {
    const workUnits = [wu({ id: "WU001" }), wu({ id: "WU002" })];
    const result = applyCheckpointWorkUnitTransition(workUnits, "WU001", "done", T2);
    expect(result.find((w) => w.id === "WU001")?.status).toBe("done");
    expect(result.find((w) => w.id === "WU001")?.updatedAt).toBe(T2);
    expect(result.find((w) => w.id === "WU002")?.status).toBe("in_progress");
  });
});

describe("computeMilestoneStatus", () => {
  it("is in_progress when any child is in_progress or needs_review", () => {
    expect(computeMilestoneStatus(["done", "in_progress"])).toBe("in_progress");
    expect(computeMilestoneStatus(["ready", "needs_review"])).toBe("in_progress");
  });

  it("is done when every child is done", () => {
    expect(computeMilestoneStatus(["done", "done"])).toBe("done");
  });

  it("is ready when no child is in_progress/needs_review and at least one is ready", () => {
    expect(computeMilestoneStatus(["done", "ready"])).toBe("ready");
    expect(computeMilestoneStatus(["ready", "planned"])).toBe("ready");
  });

  it("is planned when no child is ready/in_progress/needs_review/all-done", () => {
    expect(computeMilestoneStatus(["planned", "done"])).toBe("planned");
    expect(computeMilestoneStatus(["planned"])).toBe("planned");
  });
});

describe("recalculateMilestoneStatuses", () => {
  it("recomputes every milestone from its own children only", () => {
    const workUnits = [
      wu({ id: "WU001", milestoneId: "M001", status: "done" }),
      wu({ id: "WU002", milestoneId: "M002", status: "ready" }),
    ];
    const milestones = [
      milestone({ id: "M001", workUnitIds: ["WU001"] }),
      milestone({ id: "M002", workUnitIds: ["WU002"] }),
    ];
    const result = recalculateMilestoneStatuses(workUnits, milestones);
    expect(result.find((m) => m.id === "M001")?.status).toBe("done");
    expect(result.find((m) => m.id === "M002")?.status).toBe("ready");
  });

  it("returns the same object reference when status is unchanged", () => {
    const workUnits = [wu({ id: "WU001", milestoneId: "M001", status: "ready" })];
    const milestones = [milestone({ id: "M001", status: "ready", workUnitIds: ["WU001"] })];
    const result = recalculateMilestoneStatuses(workUnits, milestones);
    expect(result[0]).toBe(milestones[0]);
  });
});

describe("computeProjectStatus", () => {
  it("is review when the checkpointed work unit needs review", () => {
    const workUnits = [wu({ status: "needs_review" }), wu({ id: "WU002", status: "ready" })];
    expect(computeProjectStatus(workUnits, "needs_review")).toBe("review");
  });

  it("is in_progress when done but ready/planned work remains", () => {
    const workUnits = [wu({ status: "done" }), wu({ id: "WU002", status: "ready" })];
    expect(computeProjectStatus(workUnits, "done")).toBe("in_progress");
  });

  it("is review when done and every work unit is done", () => {
    const workUnits = [wu({ status: "done" }), wu({ id: "WU002", status: "done" })];
    expect(computeProjectStatus(workUnits, "done")).toBe("review");
  });
});
