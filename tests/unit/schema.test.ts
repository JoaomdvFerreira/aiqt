import { describe, it, expect } from "vitest";
import { ProjectModelSchema } from "../../src/schema/project.schema.js";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { RunlogEventSchema } from "../../src/schema/runlog-event.schema.js";
import { buildInitialProjectModel } from "../../src/state/project-store.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { buildProjectInitializedEvent } from "../../src/state/runlog-store.js";

const NOW = "2026-01-01T00:00:00.000Z";

describe("schema validation", () => {
  it("validates the initial project model", () => {
    const model = buildInitialProjectModel({
      id: "PROJECT-001",
      name: "demo",
      objective: "",
      targetUsers: [],
      preferredAgent: null,
      createdAt: NOW,
    });
    expect(ProjectModelSchema.safeParse(model).success).toBe(true);
  });

  it("validates the initial state model with an empty work graph", () => {
    const model = buildInitialStateModel(NOW);
    const parsed = StateModelSchema.safeParse(model);
    expect(parsed.success).toBe(true);
    expect(model.workGraph.milestones).toHaveLength(0);
    expect(model.nextRecommendedCommand).toBe("aiqt update");
  });

  it("validates the project.initialized runlog event", () => {
    const event = buildProjectInitializedEvent({
      id: "EVT-001",
      projectId: "PROJECT-001",
      timestamp: NOW,
      schemaVersion: "0.5.0",
    });
    expect(RunlogEventSchema.safeParse(event).success).toBe(true);
    expect(event.type).toBe("project.initialized");
  });

  it("rejects an invalid project status", () => {
    const model = buildInitialStateModel(NOW) as unknown as Record<
      string,
      unknown
    >;
    model.projectStatus = "not-a-status";
    expect(StateModelSchema.safeParse(model).success).toBe(false);
  });

  it("rejects a runlog event with an invalid actor", () => {
    const bad = {
      id: "EVT-001",
      type: "note",
      timestamp: NOW,
      actor: "robot",
      summary: "x",
      relatedIds: [],
    };
    expect(RunlogEventSchema.safeParse(bad).success).toBe(false);
  });
});
