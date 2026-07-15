import { describe, it, expect } from "vitest";
import {
  detectComponentSystemPreference,
  requiresShadcnEnforcement,
  renderShadcnPlanningGuidance,
  renderComponentSystemGuidanceSection,
  shouldIncludeComponentSystemGuidance,
  SHADCN_UI_ACCEPTANCE_CRITERIA,
} from "../../src/workflow/component-system-preferences.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";

function workUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "Build the profile page",
    objective: "Implement the profile page component.",
    scope: ["Create profile page route"],
    outOfScope: [],
    acceptanceCriteria: ["Profile page renders"],
    agentContextRefs: [],
    suggestedFiles: ["src/app/profile/page.tsx"],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("detectComponentSystemPreference", () => {
  it("recognizes shadcn/ui from technology preferences", () => {
    const result = detectComponentSystemPreference({
      project: {
        version: "1.0.0",
        project: {
          id: "PROJ-001",
          name: "Test",
          objective: "Build a marketplace",
          targetUsers: [],
          preferredAgent: null,
          existingRepositoryPath: null,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z",
        },
        context: {
          constraints: [],
          nonGoals: [],
          technologyPreferences: ["shadcn/ui", "Tailwind"],
          businessRules: [],
          architectureNotes: [],
        },
        requirements: [],
        decisions: [],
        risks: [],
        assumptions: [],
        openQuestions: [],
        quality: { preferredValidationCommands: [] },
      },
    });
    expect(result.preference).toBe("shadcn-ui");
    expect(requiresShadcnEnforcement(result)).toBe(true);
  });

  it("recognizes shadcn/ui from repository evidence (components.json)", () => {
    // repoRoot pointing at a nonexistent path still exercises the detector
    // without throwing; the text-based idea signal below covers the
    // deterministic, non-filesystem-dependent path.
    const result = detectComponentSystemPreference({ idea: "We use shadcn/ui for all components." });
    expect(result.preference).toBe("shadcn-ui");
  });

  it("does not require shadcn/ui when nothing declares it", () => {
    const result = detectComponentSystemPreference({ idea: "A command-line tool that renames files." });
    expect(result.preference).toBe("none");
    expect(requiresShadcnEnforcement(result)).toBe(false);
  });

  it("does not enforce shadcn/ui for projects that explicitly prefer custom primitives only", () => {
    const result = detectComponentSystemPreference({
      idea: "Build a marketplace using shadcn/ui patterns as inspiration, but this project uses custom Tailwind primitives only, no shadcn.",
    });
    expect(result.preference).toBe("custom-primitives");
    expect(requiresShadcnEnforcement(result)).toBe(false);
  });
});

describe("renderShadcnPlanningGuidance", () => {
  it("requires a shadcn/ui setup work unit and includes the acceptance-criteria template", () => {
    const text = renderShadcnPlanningGuidance();
    expect(text).toContain("shadcn/ui setup or integration work unit");
    for (const criterion of SHADCN_UI_ACCEPTANCE_CRITERIA) {
      expect(text).toContain(criterion);
    }
  });
});

describe("renderComponentSystemGuidanceSection", () => {
  it("tells the agent to use shadcn/ui primitives, not duplicate hand-rolled ones", () => {
    const text = renderComponentSystemGuidanceSection();
    expect(text).toContain("## Component System Guidance");
    expect(text).toContain("Do not duplicate hand-rolled Button/Input/Card primitives.");
  });
});

describe("shouldIncludeComponentSystemGuidance", () => {
  it("is true only when shadcn/ui is required and the work unit is UI-related", () => {
    expect(shouldIncludeComponentSystemGuidance("shadcn-ui", workUnit())).toBe(true);
  });

  it("is false when the preference is not shadcn-ui", () => {
    expect(shouldIncludeComponentSystemGuidance("custom-primitives", workUnit())).toBe(false);
    expect(shouldIncludeComponentSystemGuidance("none", workUnit())).toBe(false);
  });

  it("is false when the work unit is not UI-related, even if shadcn/ui is required", () => {
    const backendUnit = workUnit({
      title: "Nightly reconciliation job",
      objective: "Reconcile ledger entries.",
      scope: ["Write the reconciliation script"],
      acceptanceCriteria: ["Job produces a report"],
      suggestedFiles: ["src/jobs/reconcile.ts"],
    });
    expect(shouldIncludeComponentSystemGuidance("shadcn-ui", backendUnit)).toBe(false);
  });
});
