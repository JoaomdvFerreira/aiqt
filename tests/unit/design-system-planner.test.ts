import { describe, it, expect } from "vitest";
import { renderDesignSystemPlannerBlock } from "../../src/templates/design-system-planner-template.js";
import {
  DESIGN_SYSTEM_DIMENSIONS,
  DESIGN_SYSTEM_ANTI_PATTERNS,
  UI_WORK_UNIT_ACCEPTANCE_CRITERIA,
  DESIGN_SYSTEM_FOUNDATION_WORK_UNIT_EXAMPLE,
  DESIGN_DISCOVERY_QUESTIONS,
} from "../../src/workflow/design/design-system-planner.js";
import { buildDesignAids } from "../../src/services/skills-detection-service.js";

describe("renderDesignSystemPlannerBlock", () => {
  it("produces every required design dimension", () => {
    const block = renderDesignSystemPlannerBlock("high");
    for (const dimension of DESIGN_SYSTEM_DIMENSIONS) {
      expect(block).toContain(dimension);
    }
  });

  it("includes anti-patterns and external-agent process guidance", () => {
    const block = renderDesignSystemPlannerBlock("high");
    for (const antiPattern of DESIGN_SYSTEM_ANTI_PATTERNS) {
      expect(block).toContain(antiPattern);
    }
    expect(block).toMatch(/plan the design direction, critique it, implement bounded UI, then validate/);
  });

  it("includes UI work-unit acceptance-criteria guidance", () => {
    const block = renderDesignSystemPlannerBlock("high");
    for (const criterion of UI_WORK_UNIT_ACCEPTANCE_CRITERIA) {
      expect(block).toContain(criterion);
    }
  });

  it("includes the Design System Foundation work-unit example only for high confidence", () => {
    const high = renderDesignSystemPlannerBlock("high");
    expect(high).toContain(JSON.stringify(DESIGN_SYSTEM_FOUNDATION_WORK_UNIT_EXAMPLE, null, 2));
    expect(high).toContain("Design System Foundation");

    const medium = renderDesignSystemPlannerBlock("medium");
    expect(medium).not.toContain("design-system-foundation");
  });

  it("uses requirement language for high and recommendation language for medium", () => {
    const high = renderDesignSystemPlannerBlock("high");
    const medium = renderDesignSystemPlannerBlock("medium");
    expect(high).toMatch(/must establish/);
    expect(medium).toMatch(/Consider establishing/);
  });

  it("never mentions a new command or schema change", () => {
    const block = renderDesignSystemPlannerBlock("high");
    expect(block).not.toMatch(/aiqt design/);
    expect(block).not.toMatch(/schema/i);
  });

  it("is deterministic across repeated calls", () => {
    expect(renderDesignSystemPlannerBlock("high")).toBe(renderDesignSystemPlannerBlock("high"));
    expect(renderDesignSystemPlannerBlock("medium")).toBe(renderDesignSystemPlannerBlock("medium"));
  });
});

describe("design discovery questions", () => {
  it("cover the required discovery topics", () => {
    const joined = DESIGN_DISCOVERY_QUESTIONS.join(" ").toLowerCase();
    expect(joined).toMatch(/target users and roles/);
    expect(joined).toMatch(/user journeys/);
    expect(joined).toMatch(/brand or tone/);
    expect(joined).toMatch(/design-system preference/);
    expect(joined).toMatch(/accessibility/);
    expect(joined).toMatch(/content density/);
    expect(joined).toMatch(/mobile\/responsive/);
    expect(joined).toMatch(/motion/);
    expect(joined).toMatch(/anti-patterns/);
  });
});

describe("buildDesignAids ordering", () => {
  it("is deterministic and matches the fixed catalog order", () => {
    const project = {
      version: "1.0.0",
      project: {
        id: "PROJ-001",
        name: "Test",
        objective: "Build a Next.js React marketplace with shadcn/ui and Tailwind, including a booking flow.",
        targetUsers: [],
        preferredAgent: null,
        existingRepositoryPath: null,
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
      context: {
        constraints: [],
        nonGoals: [],
        technologyPreferences: [],
        businessRules: [],
        architectureNotes: [],
      },
      requirements: [],
      decisions: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      quality: { preferredValidationCommands: [] },
    };
    const aids = buildDesignAids("/definitely/does/not/exist", project);
    expect(aids.map((a) => a.id)).toEqual([
      "frontend-design",
      "design-critique",
      "web-design-guidelines",
      "hue",
      "transitions-refine",
    ]);
    for (const aid of aids) {
      expect(aid.installAutomatically).toBe(false);
    }
  });
});
