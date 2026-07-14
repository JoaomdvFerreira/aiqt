import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildSkillsPlan } from "../../src/services/skills-detection-service.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import { makeTempDir, removeDir } from "../helpers.js";

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
    quality: {
      acceptanceCriteriaRequired: true,
      validationRequiredBeforeDone: true,
      preferredValidationCommands: [],
    },
    ...overrides,
  };
}

describe("buildSkillsPlan", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("detects nothing in a bare repository with no evidence", () => {
    dir = makeTempDir();
    const plan = buildSkillsPlan(dir, baseProject());
    expect(plan.detectedIntegrations).toEqual([]);
    expect(plan.notDetectedIntegrations).toEqual(["supabase", "clerk", "shadcn-ui"]);
  });

  it("returns the fixed safety notes verbatim", () => {
    dir = makeTempDir();
    const plan = buildSkillsPlan(dir, baseProject());
    expect(plan.safetyNotes).toEqual([
      "AIQT does not install external skills automatically.",
      "Review public skill contents before relying on them.",
      "AIQT packet scope and project constraints override generic skill guidance.",
    ]);
  });

  it("is deterministic across repeated calls on identical repository state", () => {
    dir = makeTempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
    );
    const first = buildSkillsPlan(dir, baseProject());
    const second = buildSkillsPlan(dir, baseProject());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("orders detected integrations supabase, clerk, then shadcn-ui", () => {
    dir = makeTempDir();
    mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
    mkdirSync(join(dir, "components", "ui"), { recursive: true });
    writeFileSync(join(dir, "components.json"), "{}");
    writeFileSync(join(dir, "middleware.ts"), "// Clerk middleware\nexport default function middleware() {}\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@supabase/supabase-js": "^2.0.0",
          "@clerk/nextjs": "^5.0.0",
        },
      }),
    );
    const plan = buildSkillsPlan(dir, baseProject());
    expect(plan.detectedIntegrations.map((i) => i.id)).toEqual(["supabase", "clerk", "shadcn-ui"]);
  });

  describe("high confidence: 2+ independent direct evidence signals", () => {
    it("supabase: dependency + migrations directory", () => {
      dir = makeTempDir();
      mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
      );
      const plan = buildSkillsPlan(dir, baseProject());
      const supabase = plan.detectedIntegrations.find((i) => i.id === "supabase")!;
      expect(supabase.confidence).toBe("high");
      expect(supabase.evidence).toEqual([
        "package.json dependency @supabase/supabase-js",
        "supabase/migrations directory",
      ]);
    });

    it("clerk: dependency + middleware content reference", () => {
      dir = makeTempDir();
      writeFileSync(join(dir, "middleware.ts"), "import { clerkMiddleware } from '@clerk/nextjs/server';\n");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { "@clerk/nextjs": "^5.0.0" } }),
      );
      const plan = buildSkillsPlan(dir, baseProject());
      const clerk = plan.detectedIntegrations.find((i) => i.id === "clerk")!;
      expect(clerk.confidence).toBe("high");
      expect(clerk.evidence).toEqual([
        "package.json dependency @clerk/nextjs",
        "middleware.ts references Clerk",
      ]);
    });

    it("shadcn-ui: components.json + ui directory, with no dependency needed", () => {
      dir = makeTempDir();
      writeFileSync(join(dir, "components.json"), "{}");
      mkdirSync(join(dir, "src", "components", "ui"), { recursive: true });
      const plan = buildSkillsPlan(dir, baseProject());
      const shadcn = plan.detectedIntegrations.find((i) => i.id === "shadcn-ui")!;
      expect(shadcn.confidence).toBe("high");
      expect(shadcn.evidence).toEqual(["components.json", "src/components/ui directory"]);
    });
  });

  describe("medium confidence: exactly one direct signal, or strong context alone", () => {
    it("supabase: dependency only", () => {
      dir = makeTempDir();
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
      );
      const plan = buildSkillsPlan(dir, baseProject());
      expect(plan.detectedIntegrations.find((i) => i.id === "supabase")!.confidence).toBe("medium");
    });

    it("clerk: strong technologyPreferences mention only, no dependency or file evidence", () => {
      dir = makeTempDir();
      const project = baseProject({
        context: {
          constraints: [],
          nonGoals: [],
          technologyPreferences: ["Clerk"],
          businessRules: [],
          architectureNotes: [],
        },
      });
      const plan = buildSkillsPlan(dir, project);
      expect(plan.detectedIntegrations.find((i) => i.id === "clerk")!.confidence).toBe("medium");
    });
  });

  describe("low confidence: weak textual mention only", () => {
    it("supabase mentioned only in the project objective", () => {
      dir = makeTempDir();
      const project = baseProject({
        project: { ...baseProject().project, objective: "Use Supabase for storage" },
      });
      const plan = buildSkillsPlan(dir, project);
      expect(plan.detectedIntegrations.find((i) => i.id === "supabase")!.confidence).toBe("low");
    });
  });

  it("maps the shadcn/ui display name to the shadcn-ui JSON id", () => {
    dir = makeTempDir();
    writeFileSync(join(dir, "components.json"), "{}");
    mkdirSync(join(dir, "src", "components", "ui"), { recursive: true });
    const plan = buildSkillsPlan(dir, baseProject());
    const shadcn = plan.detectedIntegrations.find((i) => i.displayName === "shadcn/ui")!;
    expect(shadcn.id).toBe("shadcn-ui");
  });

  it("recommends the exact install commands from the spec", () => {
    dir = makeTempDir();
    mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@supabase/supabase-js": "^2.0.0", "@clerk/nextjs": "^5.0.0" },
      }),
    );
    writeFileSync(join(dir, "middleware.ts"), "clerk middleware\n");
    writeFileSync(join(dir, "components.json"), "{}");
    mkdirSync(join(dir, "src", "components", "ui"), { recursive: true });
    const plan = buildSkillsPlan(dir, baseProject());
    expect(plan.detectedIntegrations.find((i) => i.id === "supabase")!.recommendedSkill).toEqual({
      id: "supabase-agent-skills",
      installCommand: "npx skills add supabase/agent-skills",
      installAutomatically: false,
    });
    expect(plan.detectedIntegrations.find((i) => i.id === "clerk")!.recommendedSkill).toEqual({
      id: "clerk-skills",
      installCommand: "npx skills add clerk/skills",
      installAutomatically: false,
    });
    expect(plan.detectedIntegrations.find((i) => i.id === "shadcn-ui")!.recommendedSkill).toEqual({
      id: "shadcn-ui",
      installCommand: "pnpm dlx skills add shadcn/ui",
      installAutomatically: false,
    });
  });

  it("tolerates a missing package.json without throwing", () => {
    dir = makeTempDir();
    expect(() => buildSkillsPlan(dir, baseProject())).not.toThrow();
  });

  it("tolerates a malformed package.json without throwing", () => {
    dir = makeTempDir();
    writeFileSync(join(dir, "package.json"), "{ not valid json");
    expect(() => buildSkillsPlan(dir, baseProject())).not.toThrow();
  });
});
