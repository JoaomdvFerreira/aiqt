import { describe, it, expect } from "vitest";
import { selectRelevantSkills } from "../../src/services/agent-packet-service.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { DetectedIntegration } from "../../src/services/skills-detection-service.js";

const T1 = "2026-01-01T00:00:00.000Z";

function workUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "Implement feature",
    objective: "o",
    scope: ["s"],
    outOfScope: ["oos"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function integration(overrides: Partial<DetectedIntegration> = {}): DetectedIntegration {
  return {
    id: "supabase",
    displayName: "Supabase",
    confidence: "high",
    evidence: [],
    recommendedSkill: {
      id: "supabase-agent-skills",
      installCommand: "npx skills add supabase/agent-skills",
      installAutomatically: false,
    },
    ...overrides,
  };
}

describe("selectRelevantSkills", () => {
  it("includes an integration whose keyword appears in the work unit title", () => {
    const wu = workUnit({ title: "Wire up Supabase auth" });
    const result = selectRelevantSkills(wu, [integration({ id: "supabase" })]);
    expect(result.map((i) => i.id)).toEqual(["supabase"]);
  });

  it("includes an integration whose keyword appears in scope", () => {
    const wu = workUnit({ scope: ["Add Clerk middleware"] });
    const clerk = integration({ id: "clerk", displayName: "Clerk" });
    expect(selectRelevantSkills(wu, [clerk]).map((i) => i.id)).toEqual(["clerk"]);
  });

  it("excludes an integration whose keyword does not appear anywhere in the work unit's text", () => {
    const wu = workUnit({ title: "Implement checkout flow", scope: ["Add cart"], suggestedFiles: ["src/cart.ts"] });
    const supabase = integration({ id: "supabase" });
    expect(selectRelevantSkills(wu, [supabase])).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const wu = workUnit({ title: "SUPABASE row level security policies" });
    const supabase = integration({ id: "supabase" });
    expect(selectRelevantSkills(wu, [supabase])).toHaveLength(1);
  });

  it("filters a mixed list down to only the touched integrations", () => {
    const wu = workUnit({ title: "shadcn/ui button component" });
    const shadcn = integration({ id: "shadcn-ui", displayName: "shadcn/ui" });
    const supabase = integration({ id: "supabase" });
    const result = selectRelevantSkills(wu, [supabase, shadcn]);
    expect(result.map((i) => i.id)).toEqual(["shadcn-ui"]);
  });
});
