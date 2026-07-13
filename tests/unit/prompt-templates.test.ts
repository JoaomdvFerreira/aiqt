import { describe, it, expect } from "vitest";
import { renderUpdatePrompt } from "../../src/templates/prompts/update.prompt.template.js";
import { renderPlanPrompt } from "../../src/templates/prompts/plan.prompt.template.js";
import { renderCheckpointPrompt } from "../../src/templates/prompts/checkpoint.prompt.template.js";
import { renderDriverPrompt } from "../../src/templates/prompts/driver.prompt.template.js";
import { renderInterviewPrompt } from "../../src/templates/prompts/interview.prompt.template.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { AgentPacketMetadata } from "../../src/schema/agent-packet.schema.js";

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "draft",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: { milestones: [], workUnits: [], dependencies: [] },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

  it("M8: does not include full-stack planning guidance when no full-stack signal is present", () => {
    expect(prompt).not.toMatch(/Full-stack planning guidance/);
  });

  it("M8: includes full-stack planning guidance when technology preferences signal a web app", () => {
    const fullStackPrompt = renderPlanPrompt(
      baseProject({
        context: {
          constraints: [],
          nonGoals: [],
          technologyPreferences: ["Next.js", "Supabase", "Clerk"],
          businessRules: [],
          architectureNotes: [],
        },
      }),
    );
    expect(fullStackPrompt).toMatch(/Full-stack planning guidance/);
    expect(fullStackPrompt).toContain("auth boundaries, roles, permissions, and protected routes");
    expect(fullStackPrompt).toContain("routes/pages in the Next.js App Router or equivalent router");
    expect(fullStackPrompt).toContain("server actions, API routes, or backend service functions");
    expect(fullStackPrompt).toContain(
      "Keep work units bounded. Do not create one massive work unit for the whole app.",
    );
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

describe("renderDriverPrompt", () => {
  it("tells the agent not to immediately implement from the rough idea", () => {
    const prompt = renderDriverPrompt({ project: null, state: null, idea: null });
    expect(prompt).toMatch(/Do not immediately implement from the rough idea/);
  });

  it("includes the idea block only when an idea is supplied", () => {
    const withoutIdea = renderDriverPrompt({ project: null, state: null, idea: null });
    expect(withoutIdea).not.toContain("Rough idea:");

    const withIdea = renderDriverPrompt({ project: null, state: null, idea: "Build a marketplace" });
    expect(withIdea).toContain("Rough idea:");
    expect(withIdea).toContain("Build a marketplace");
  });

  it("instructs the agent to init first when no project exists yet", () => {
    const prompt = renderDriverPrompt({ project: null, state: null, idea: null });
    expect(prompt).toContain("No AIQT project found yet in this folder. Run aiqt init first.");
    expect(prompt).toContain("Run aiqt init if .aiqt/ does not exist.");
  });

  it("shows the current project status and next recommended command once a project exists", () => {
    const prompt = renderDriverPrompt({
      project: baseProject(),
      state: baseState({ projectStatus: "planned", nextRecommendedCommand: "aiqt next" }),
      idea: null,
    });
    expect(prompt).toContain("Project status: planned.");
    expect(prompt).toContain("Next recommended command: aiqt next.");
  });

  it("describes the preferred stdin path and the optional file-based path", () => {
    const prompt = renderDriverPrompt({ project: null, state: null, idea: null });
    expect(prompt).toContain("aiqt import update --stdin");
    expect(prompt).toContain("aiqt import plan --stdin");
    expect(prompt).toContain("aiqt import checkpoint --stdin");
    expect(prompt).toMatch(/--from-file <path> instead of --stdin/);
  });

  it("warns against manually editing canonical files or creating markdown source-of-truth files", () => {
    const prompt = renderDriverPrompt({ project: null, state: null, idea: null });
    expect(prompt).toContain("Do not manually edit .aiqt/project.json or .aiqt/state.json.");
    expect(prompt).toContain("Do not create markdown source-of-truth files.");
  });

  it("is deterministic for the same input", () => {
    const input = { project: baseProject(), state: baseState(), idea: "idea" };
    expect(renderDriverPrompt(input)).toBe(renderDriverPrompt(input));
  });
});

describe("renderInterviewPrompt", () => {
  it("asks the user for their idea first when no idea or project objective is available", () => {
    const result = renderInterviewPrompt(null, null);
    expect(result.prompt).toMatch(/Ask the user for their product idea before asking any other question/);
    expect(result.prompt).toContain("Project idea: (not supplied yet)");
  });

  it("uses the supplied --idea over an existing project objective", () => {
    const result = renderInterviewPrompt(
      baseProject({ project: { ...baseProject().project, objective: "Recorded objective" } }),
      "Fresh idea from --idea",
    );
    expect(result.prompt).toContain("Project idea: Fresh idea from --idea");
  });

  it("falls back to the recorded project objective when no --idea is supplied", () => {
    const result = renderInterviewPrompt(
      baseProject({ project: { ...baseProject().project, objective: "Recorded objective" } }),
      null,
    );
    expect(result.prompt).toContain("Project idea: Recorded objective");
  });

  it("asks only the base questions when no full-stack signal is detected", () => {
    const result = renderInterviewPrompt(null, "A simple CLI tool for renaming files");
    expect(result.detectedProjectType).toBeNull();
    expect(result.questions).toHaveLength(7);
  });

  it("asks the full-stack questions too when a full-stack signal is detected in the idea", () => {
    const result = renderInterviewPrompt(null, "Build me a marketplace for handmade goods");
    expect(result.detectedProjectType).toBe("full-stack web application");
    expect(result.questions).toHaveLength(15);
    expect(result.prompt).toMatch(/user roles/);
    expect(result.prompt).toMatch(/routes\/pages or screens/);
  });

  it("detects full-stack signals from existing project technology preferences when no --idea is supplied", () => {
    const result = renderInterviewPrompt(
      baseProject({
        project: { ...baseProject().project, objective: "Ship the app" },
        context: {
          constraints: [],
          nonGoals: [],
          technologyPreferences: ["Next.js", "Supabase"],
          businessRules: [],
          architectureNotes: [],
        },
      }),
      null,
    );
    expect(result.detectedProjectType).toBe("full-stack web application");
  });

  it("ends with the update --stdin follow-up instruction", () => {
    const result = renderInterviewPrompt(null, "idea");
    expect(result.prompt).toContain("aiqt import update --stdin");
  });

  it("is deterministic for the same input", () => {
    expect(renderInterviewPrompt(null, "idea").prompt).toBe(renderInterviewPrompt(null, "idea").prompt);
  });
});
