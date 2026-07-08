import { describe, it, expect } from "vitest";
import { isPlanningContextReady } from "../../src/workflow/planning-readiness.js";
import { buildInitialProjectModel } from "../../src/state/project-store.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";

const NOW = "2026-01-01T00:00:00.000Z";

function baseProject(): ProjectModel {
  return buildInitialProjectModel({
    id: "PROJECT-001",
    name: "demo",
    objective: "",
    targetUsers: [],
    preferredAgent: null,
    createdAt: NOW,
  });
}

describe("isPlanningContextReady", () => {
  it("is not ready for a fresh init with no context", () => {
    expect(isPlanningContextReady(baseProject())).toBe(false);
  });

  it("is not ready with only an objective (no target users)", () => {
    const project = baseProject();
    project.project.objective = "Build a thing";
    expect(isPlanningContextReady(project)).toBe(false);
  });

  it("is ready with objective, target user, and an accepted requirement", () => {
    const project = baseProject();
    project.project.objective = "Build a thing";
    project.project.targetUsers = ["devs"];
    project.requirements = [
      {
        id: "REQ-001",
        title: "T",
        description: "D",
        priority: "medium",
        type: "functional",
        acceptanceCriteria: [],
        status: "accepted",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    expect(isPlanningContextReady(project)).toBe(true);
  });

  it("is ready with objective, target user, and a context constraint", () => {
    const project = baseProject();
    project.project.objective = "Build a thing";
    project.project.targetUsers = ["devs"];
    project.context.constraints = ["local only"];
    expect(isPlanningContextReady(project)).toBe(true);
  });

  it("is not ready when a blocking open question is open", () => {
    const project = baseProject();
    project.project.objective = "Build a thing";
    project.project.targetUsers = ["devs"];
    project.context.constraints = ["local only"];
    project.openQuestions = [
      {
        id: "Q001",
        question: "Blocking?",
        impact: "blocking",
        status: "open",
        answer: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    expect(isPlanningContextReady(project)).toBe(false);
  });

  it("is ready when a blocking open question exists but is answered/dismissed", () => {
    const project = baseProject();
    project.project.objective = "Build a thing";
    project.project.targetUsers = ["devs"];
    project.context.constraints = ["local only"];
    project.openQuestions = [
      {
        id: "Q001",
        question: "Blocking?",
        impact: "blocking",
        status: "answered",
        answer: "Resolved.",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    expect(isPlanningContextReady(project)).toBe(true);
  });
});
