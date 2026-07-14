import { describe, it, expect } from "vitest";
import {
  findOrCreateRepairMilestone,
  buildPromotedWorkUnit,
  applyIssuePromotion,
  REPAIR_MILESTONE_TITLE,
} from "../../src/workflow/repair-work-graph.js";
import type { WorkGraph } from "../../src/schema/work-graph.schema.js";

function emptyGraph(): WorkGraph {
  return { milestones: [], workUnits: [], dependencies: [] };
}

function graphWithMilestones(ids: string[]): WorkGraph {
  return {
    milestones: ids.map((id) => ({
      id,
      title: `Milestone ${id}`,
      objective: "obj",
      status: "done" as const,
      workUnitIds: [],
    })),
    workUnits: [],
    dependencies: [],
  };
}

describe("findOrCreateRepairMilestone", () => {
  it("creates the next canonical M### id (never M-REPAIR) when none exists", () => {
    const result = findOrCreateRepairMilestone(graphWithMilestones(["M001", "M002"]));
    expect(result.created).toBe(true);
    expect(result.milestone.id).toBe("M003");
    expect(result.milestone.title).toBe(REPAIR_MILESTONE_TITLE);
  });

  it("uses M001 as the first canonical id on an empty graph", () => {
    const result = findOrCreateRepairMilestone(emptyGraph());
    expect(result.milestone.id).toBe("M001");
  });

  it("reuses an existing repair milestone found by title", () => {
    const graph: WorkGraph = {
      milestones: [
        { id: "M001", title: "Foundation", objective: "o", status: "done", workUnitIds: [] },
        { id: "M002", title: REPAIR_MILESTONE_TITLE, objective: "o", status: "planned", workUnitIds: [] },
      ],
      workUnits: [],
      dependencies: [],
    };
    const result = findOrCreateRepairMilestone(graph);
    expect(result.created).toBe(false);
    expect(result.milestone.id).toBe("M002");
  });
});

describe("buildPromotedWorkUnit", () => {
  it("produces a WU### id with all required fields non-empty and status ready", () => {
    const wu = buildPromotedWorkUnit({
      workGraph: emptyGraph(),
      milestoneId: "M001",
      title: "Repair remaining form error wrappers",
      issueMessage: "Remaining form error wrappers",
      validationCommands: ["pnpm test"],
      timestamp: "2026-07-14T00:00:00.000Z",
    });
    expect(wu.id).toBe("WU001");
    expect(wu.title).not.toBe("");
    expect(wu.objective).not.toBe("");
    expect(wu.scope.length).toBeGreaterThan(0);
    expect(wu.outOfScope.length).toBeGreaterThan(0);
    expect(wu.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(wu.validationCommands).toEqual(["pnpm test"]);
    expect(wu.status).toBe("ready");
    expect(wu.dependencies).toEqual([]);
  });
});

describe("applyIssuePromotion", () => {
  it("creates a repair milestone and work unit, and links them", () => {
    const result = applyIssuePromotion({
      workGraph: graphWithMilestones(["M001"]),
      title: "Repair remaining form error wrappers",
      issueMessage: "Remaining form error wrappers",
      validationCommands: ["pnpm test"],
      timestamp: "2026-07-14T00:00:00.000Z",
    });
    expect(result.milestoneCreated).toBe(true);
    expect(result.milestone.id).toBe("M002");
    expect(result.workUnit.id).toBe("WU001");
    expect(result.milestone.workUnitIds).toContain("WU001");
    expect(result.workGraph.workUnits).toHaveLength(1);
  });

  it("reuses the same repair milestone across multiple promotions", () => {
    const first = applyIssuePromotion({
      workGraph: graphWithMilestones(["M001"]),
      title: "Repair A",
      issueMessage: "Issue A",
      validationCommands: ["pnpm test"],
      timestamp: "2026-07-14T00:00:00.000Z",
    });
    const second = applyIssuePromotion({
      workGraph: first.workGraph,
      title: "Repair B",
      issueMessage: "Issue B",
      validationCommands: ["pnpm test"],
      timestamp: "2026-07-14T00:01:00.000Z",
    });
    expect(second.milestoneCreated).toBe(false);
    expect(second.milestone.id).toBe(first.milestone.id);
    expect(second.workUnit.id).toBe("WU002");
    expect(second.milestone.workUnitIds).toEqual(["WU001", "WU002"]);
  });
});
