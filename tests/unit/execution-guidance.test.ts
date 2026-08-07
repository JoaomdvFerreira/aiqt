import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyWorkComplexity,
  recommendAgentClass,
  resolveConcreteRecommendation,
  buildValidationGuidance,
  buildOutputPolicy,
  buildSubagentGuidance,
  composeExecutionGuidance,
  type WorkComplexitySignalsInput,
} from "../../src/workflow/execution-guidance.js";
import type { ExecutionGuidanceProfileConfigPartial } from "../../src/schema/execution-guidance.schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function baseInput(overrides: Partial<WorkComplexitySignalsInput> = {}): WorkComplexitySignalsInput {
  return {
    objective: "Fix a typo in a log message.",
    scope: ["src/foo.ts"],
    outOfScope: [],
    acceptanceCriteria: ["The log message no longer contains a typo."],
    suggestedFiles: ["src/foo.ts"],
    dependencies: [],
    autonomousRiskClass: null,
    ...overrides,
  };
}

describe("execution-guidance (M39-WU01)", () => {
  it("is deterministic for identical input", () => {
    const input = baseInput({ scope: ["a", "b", "c", "d"], suggestedFiles: ["a.ts", "b.ts"] });
    const first = classifyWorkComplexity(input);
    const second = classifyWorkComplexity(input);
    expect(second).toEqual(first);

    const composeInput = { workUnitId: "WU-1", workUnit: input };
    expect(composeExecutionGuidance(composeInput)).toEqual(composeExecutionGuidance(composeInput));
  });

  it("classifies mechanical: minimal breadth, no risk terms", () => {
    const result = classifyWorkComplexity(baseInput({ scope: [], suggestedFiles: [], dependencies: [], acceptanceCriteria: ["one AC"] }));
    expect(result.value).toBe("mechanical");
    expect(recommendAgentClass("mechanical").reasoningEffort).toBe("low");
    expect(recommendAgentClass("mechanical").recommendedClass).toBe("economy");
  });

  it("classifies simple: bounded breadth, no risk terms", () => {
    const result = classifyWorkComplexity(baseInput({ scope: ["a", "b"], suggestedFiles: ["a.ts"], dependencies: [] }));
    expect(result.value).toBe("simple");
    expect(recommendAgentClass("simple").reasoningEffort).toBe("low");
  });

  it("classifies standard: breadth above simple threshold, no risk terms", () => {
    const result = classifyWorkComplexity(baseInput({ scope: ["a", "b", "c"], suggestedFiles: ["a.ts", "b.ts"], dependencies: ["d1"] }));
    expect(result.value).toBe("standard");
    const rec = recommendAgentClass("standard");
    expect(rec.reasoningEffort).toBe("medium");
    expect(rec.recommendedClass).toBe("balanced");
  });

  it("classifies complex: explicit risk term present", () => {
    const result = classifyWorkComplexity(baseInput({ objective: "Harden the authentication and concurrency handling." }));
    expect(result.value).toBe("complex");
    const rec = recommendAgentClass("complex");
    expect(rec.reasoningEffort).toBe("high");
    expect(rec.recommendedClass).toBe("strong");
  });

  it("classifies architectural: explicit migration/schema-version term present", () => {
    const result = classifyWorkComplexity(baseInput({ objective: "Perform a canonical schema version migration." }));
    expect(result.value).toBe("architectural");
    const rec = recommendAgentClass("architectural");
    expect(rec.reasoningEffort).toBe("high");
    expect(rec.recommendedClass).toBe("strong");
  });

  it("classifies complex when the autonomous risk classification requires approval", () => {
    const result = classifyWorkComplexity(baseInput({ autonomousRiskClass: "medium_risk_requires_approval" }));
    expect(result.value).toBe("complex");
  });

  it("classifies architectural when the autonomous risk classification is always-blocked", () => {
    const result = classifyWorkComplexity(baseInput({ autonomousRiskClass: "high_risk_prohibited" }));
    expect(result.value).toBe("architectural");
  });

  it("keeps low confidence explicit when no signals are available at all", () => {
    const result = classifyWorkComplexity(
      baseInput({ objective: "", scope: [], suggestedFiles: [], dependencies: [], acceptanceCriteria: [] }),
    );
    expect(result.confidence).toBe("low");
    expect(result.value).toBe("standard");
    expect(result.reasons.join(" ")).toMatch(/low confidence/i);
  });

  it("generic guidance works with no provider profile configured", () => {
    const guidance = composeExecutionGuidance({ workUnitId: "WU-2", workUnit: baseInput() });
    expect(guidance.agent.concreteRecommendation).toBeNull();
    expect(guidance.agent.advisory).toBe(true);
  });

  it("a configured profile produces a concrete model mapping", () => {
    const profileConfig: ExecutionGuidanceProfileConfigPartial = {
      agentClassProfiles: {
        balanced: { medium: { agent: "Claude Code", model: "Sonnet 5", effort: "medium" } },
      },
    };
    const concrete = resolveConcreteRecommendation("balanced", "medium", profileConfig);
    expect(concrete).toEqual({ agent: "Claude Code", model: "Sonnet 5", effort: "medium" });
  });

  it("balanced + medium maps to the configured Claude Code / Sonnet 5 / medium fixture via composeExecutionGuidance", () => {
    const profileConfig: ExecutionGuidanceProfileConfigPartial = {
      agentClassProfiles: {
        balanced: { medium: { agent: "Claude Code", model: "Sonnet 5", effort: "medium" } },
      },
    };
    const guidance = composeExecutionGuidance({
      workUnitId: "WU-3",
      workUnit: baseInput({ scope: ["a", "b", "c"], suggestedFiles: ["a.ts", "b.ts"], dependencies: ["d1"] }),
      profileConfig,
    });
    expect(guidance.agent.recommendedClass).toBe("balanced");
    expect(guidance.agent.reasoningEffort).toBe("medium");
    expect(guidance.agent.concreteRecommendation).toEqual({ agent: "Claude Code", model: "Sonnet 5", effort: "medium" });
  });

  it("changing the concrete provider mapping never changes the underlying complexity classification", () => {
    const workUnit = baseInput({ objective: "Harden authentication." });
    const withoutProfile = composeExecutionGuidance({ workUnitId: "WU-4", workUnit });
    const withProfile = composeExecutionGuidance({
      workUnitId: "WU-4",
      workUnit,
      profileConfig: { agentClassProfiles: { strong: { high: { agent: "Codex", model: "gpt-x", effort: "high" } } } },
    });
    expect(withProfile.complexity).toEqual(withoutProfile.complexity);
    expect(withProfile.agent.recommendedClass).toBe(withoutProfile.agent.recommendedClass);
    expect(withProfile.agent.reasoningEffort).toBe(withoutProfile.agent.reasoningEffort);
    expect(withProfile.agent.concreteRecommendation).not.toBeNull();
    expect(withoutProfile.agent.concreteRecommendation).toBeNull();
  });

  it("validation defaults encode focused/static-per-WU and full-at-milestone-closure policy", () => {
    const wu = buildValidationGuidance();
    expect(wu.requiredNow.map((s) => s.tier)).toEqual(["static", "focused"]);
    expect(wu.deferred.some((s) => s.tier === "full")).toBe(true);
    expect(wu.fullSuiteRequiredAt).toBe("milestone_closure");

    const closure = buildValidationGuidance({ isMilestoneClosure: true });
    expect(closure.requiredNow.map((s) => s.tier).sort()).toEqual(["full", "milestone"]);
    expect(closure.fullSuiteRequiredAt).toBe("milestone_closure");
  });

  it("full-at-work-unit requires an explicit, recorded rationale signal", () => {
    const withoutReason = buildValidationGuidance();
    expect(withoutReason.requiredNow.some((s) => s.tier === "full")).toBe(false);

    const withReason = buildValidationGuidance({ explicitFullSuiteReason: "Change touches the canonical schema-version gate." });
    expect(withReason.requiredNow.some((s) => s.tier === "full")).toBe(true);
    expect(withReason.fullSuiteRequiredAt).toBe("work_unit");
    expect(withReason.reasons.join(" ")).toContain("canonical schema-version gate");
  });

  it("output policy defaults to compact-success/full-failure", () => {
    expect(buildOutputPolicy()).toEqual({ passingCommandDetail: "summary", failureDetail: "full" });
  });

  it("subagent policy defaults to none for mechanical/simple/standard Work Units even with a justification", () => {
    expect(buildSubagentGuidance("mechanical", "some reason").mode).toBe("none");
    expect(buildSubagentGuidance("simple", "some reason").mode).toBe("none");
    expect(buildSubagentGuidance("standard", "some reason").mode).toBe("none");
  });

  it("subagent policy allows a single targeted subagent only for complex/architectural work with a justification", () => {
    const noJustification = buildSubagentGuidance("complex", null);
    expect(noJustification.mode).toBe("none");

    const justified = buildSubagentGuidance("architectural", "independent security review needed");
    expect(justified.mode).toBe("targeted");
    expect(justified.maxParallel).toBe(1);
    expect(justified.reason).toBe("independent security review needed");
  });

  it("subagent mode cannot represent a recursive swarm (type-level: only 'none' | 'targeted', maxParallel never exceeds 1)", () => {
    const guidance = buildSubagentGuidance("architectural", "justified");
    expect(["none", "targeted"]).toContain(guidance.mode);
    expect(guidance.maxParallel).toBeLessThanOrEqual(1);
  });

  it("has no provider/billing API dependency and no automatic model-switching call site", () => {
    for (const relPath of [
      "src/workflow/execution-guidance.ts",
      "src/schema/execution-guidance.schema.ts",
      "src/services/execution-guidance-profile-config-file.ts",
    ]) {
      const source = readFileSync(join(repoRoot, relPath), "utf8");
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/\bnode:https?\b/);
      expect(source).not.toMatch(/\bchild_process\b/);
      expect(source).not.toMatch(/import[^;]*AutonomousOperatorConfigSchema/);
      expect(source).not.toMatch(/liveExecutionEnabled\s*=/);
    }
  });

  it("introduces no new canonical state file (no writeStateModel/atomicWriteFileSync/runlog usage)", () => {
    for (const relPath of [
      "src/workflow/execution-guidance.ts",
      "src/schema/execution-guidance.schema.ts",
      "src/services/execution-guidance-profile-config-file.ts",
    ]) {
      const source = readFileSync(join(repoRoot, relPath), "utf8");
      expect(source).not.toMatch(/writeStateModel|atomicWriteFileSync|appendRunlogEvent/);
    }
  });
});
