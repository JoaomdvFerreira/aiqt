import { describe, it, expect } from "vitest";
import { renderUpdatePrompt } from "../../src/templates/prompts/update.prompt.template.js";
import { renderPlanPrompt } from "../../src/templates/prompts/plan.prompt.template.js";
import { renderCheckpointPrompt } from "../../src/templates/prompts/checkpoint.prompt.template.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { AgentPacketMetadata } from "../../src/schema/agent-packet.schema.js";

function baseProject(overrides: Partial<ProjectModel> = {}): ProjectModel {
  return {
    version: "1.0.0",
    project: {
      id: "PROJECT-001",
      name: "Test",
      objective: "Ship it",
      targetUsers: ["devs"],
      preferredAgent: null,
      existingRepositoryPath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    context: {
      constraints: ["Local files are the source of truth"],
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
    quality: {
      acceptanceCriteriaRequired: true,
      validationRequiredBeforeDone: true,
      preferredValidationCommands: [],
    },
    ...overrides,
  };
}

describe("renderUpdatePrompt", () => {
  const prompt = renderUpdatePrompt(baseProject());

  it("instructs the agent to return JSON only, without markdown fences", () => {
    expect(prompt).toMatch(/Return JSON only/);
    expect(prompt).toMatch(/Do not wrap the JSON in markdown/);
  });

  it("instructs the agent not to modify source code", () => {
    expect(prompt).toMatch(/Do not modify any source code/);
  });

  it("includes current project objective and target users", () => {
    expect(prompt).toContain("Ship it");
    expect(prompt).toContain("devs");
  });

  it("includes the expected update JSON top-level fields", () => {
    expect(prompt).toContain('"project"');
    expect(prompt).toContain('"context"');
    expect(prompt).toContain('"requirements"');
    expect(prompt).toContain('"quality"');
  });

  it("includes the suggested save path and follow-up command", () => {
    expect(prompt).toContain(".aiqt/inputs/update.json");
    expect(prompt).toContain("aiqt import update --from-file .aiqt/inputs/update.json");
  });

  it("is deterministic for the same input", () => {
    expect(renderUpdatePrompt(baseProject())).toBe(prompt);
  });
});

describe("renderPlanPrompt", () => {
  const prompt = renderPlanPrompt(baseProject());

  it("instructs the agent to return JSON only, without markdown fences", () => {
    expect(prompt).toMatch(/Return JSON only/);
    expect(prompt).toMatch(/Do not wrap the JSON in markdown/);
  });

  it("includes the expected plan JSON top-level fields", () => {
    expect(prompt).toContain('"milestones"');
    expect(prompt).toContain('"workUnits"');
    expect(prompt).toContain('"dependencies"');
  });

  it("includes compact current project context", () => {
    expect(prompt).toContain("Ship it");
    expect(prompt).toContain("devs");
    expect(prompt).toContain("Local files are the source of truth");
  });

  it("includes the suggested save path and follow-up command", () => {
    expect(prompt).toContain(".aiqt/inputs/plan.json");
    expect(prompt).toContain("aiqt import plan --from-file .aiqt/inputs/plan.json");
  });

  it("RC1: warns against broad category-level agentContextRefs and recommends specific record ids", () => {
    expect(prompt).toMatch(/agentContextRefs/);
    expect(prompt).toMatch(/EVERY record of that category/);
    expect(prompt).toMatch(/prefer a specific record id/);
    expect(prompt).toContain('["REQ-001"]');
  });

  it("RC1: shows requirement ids alongside titles so the agent can reference a specific one", () => {
    const withRequirements = renderPlanPrompt(
      baseProject({
        requirements: [
          {
            id: "REQ-001",
            title: "Add item",
            description: "d",
            priority: "medium",
            type: "functional",
            acceptanceCriteria: [],
            status: "accepted",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(withRequirements).toContain("[REQ-001] Add item");
  });
});

describe("renderCheckpointPrompt", () => {
  const workUnit: WorkUnit = {
    id: "WU001",
    milestoneId: "M001",
    title: "Initialize app",
    objective: "Create runnable shell.",
    scope: ["Create scaffold"],
    outOfScope: ["No auth"],
    acceptanceCriteria: ["App starts"],
    agentContextRefs: [],
    suggestedFiles: ["package.json"],
    validationCommands: ["pnpm test"],
    status: "in_progress",
    dependencies: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const packet: AgentPacketMetadata = {
    id: "PKT-001",
    workUnitId: "WU001",
    milestoneId: "M001",
    createdAt: "2026-01-01T00:00:00.000Z",
    format: "markdown",
    contentHash: "abc123",
    sourceCommand: "aiqt next",
  };
  const prompt = renderCheckpointPrompt(workUnit, packet);

  it("instructs the agent to return JSON only, without markdown fences", () => {
    expect(prompt).toMatch(/Return JSON only/);
    expect(prompt).toMatch(/Do not wrap the JSON in markdown/);
  });

  it("includes the current work unit, acceptance criteria, and validation commands", () => {
    expect(prompt).toContain("WU001");
    expect(prompt).toContain("App starts");
    expect(prompt).toContain("pnpm test");
  });

  it("includes packet metadata", () => {
    expect(prompt).toContain("PKT-001");
  });

  it("includes a placeholder for the agent implementation report", () => {
    expect(prompt).toMatch(/paste the agent's report/i);
  });

  it("includes the expected checkpoint JSON top-level fields", () => {
    expect(prompt).toContain('"validationResult"');
    expect(prompt).toContain('"acceptanceCriteriaResult"');
    expect(prompt).toContain('"targetStatus"');
  });

  it("includes the suggested save path and follow-up command", () => {
    expect(prompt).toContain(".aiqt/inputs/checkpoint.json");
    expect(prompt).toContain("aiqt import checkpoint --from-file .aiqt/inputs/checkpoint.json");
  });
});
