import { describe, it, expect } from "vitest";
import { renderExecutionGuidanceHuman, renderExecutionGuidancePromptNote } from "../../src/workflow/execution-guidance-render.js";
import { composeExecutionGuidance } from "../../src/workflow/execution-guidance.js";
import type { WorkComplexitySignalsInput } from "../../src/workflow/execution-guidance.js";

function workUnit(overrides: Partial<WorkComplexitySignalsInput> = {}): WorkComplexitySignalsInput {
  return {
    objective: "Implement a bounded feature.",
    scope: ["a", "b", "c"],
    outOfScope: [],
    acceptanceCriteria: ["AC1"],
    suggestedFiles: ["src/a.ts", "src/b.ts"],
    dependencies: ["d1"],
    autonomousRiskClass: null,
    ...overrides,
  };
}

describe("execution-guidance-render (M39-WU03)", () => {
  it("renders the exact compact block shape from the build spec's Sec 9 example", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "WU-1",
      workUnit: workUnit(),
      profileConfig: { agentClassProfiles: { balanced: { medium: { agent: "Claude Code", model: "Sonnet 5", effort: "medium" } } } },
      contextManifestInput: { suggestedFiles: ["src/a.ts"] },
    });
    const rendered = renderExecutionGuidanceHuman(guidance);
    const lines = rendered.split("\n");
    expect(lines[0]).toBe("Execution Guidance");
    expect(lines).toContain(`Complexity: ${guidance.complexity.value}`);
    expect(lines).toContain(`Reasoning: ${guidance.agent.reasoningEffort}`);
    expect(lines).toContain(`Agent class: ${guidance.agent.recommendedClass}`);
    expect(lines).toContain("Configured: Claude Code / Sonnet 5 / medium");
    expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
    expect(lines.some((l) => l.startsWith("Validation now: "))).toBe(true);
    expect(lines.some((l) => l.startsWith("Deferred: "))).toBe(true);
    expect(lines).toContain("Subagents: none");
    expect(lines).toContain("Output: summarize success; retain detailed failures");
  });

  it("renders 'none (generic guidance only)' when no concrete profile is configured", () => {
    const guidance = composeExecutionGuidance({ workUnitId: "WU-2", workUnit: workUnit() });
    expect(renderExecutionGuidanceHuman(guidance)).toContain("Configured: none (generic guidance only)");
  });

  it("never embeds context item paths or validation reason text in the compact human render", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "WU-3",
      workUnit: workUnit(),
      contextManifestInput: { suggestedFiles: ["src/very-specific-path.ts"] },
    });
    const rendered = renderExecutionGuidanceHuman(guidance);
    expect(rendered).not.toContain("src/very-specific-path.ts");
  });

  it("the prompt note tells the agent to follow guidance and expand context only on evidence, not to investigate broadly", () => {
    const guidance = composeExecutionGuidance({ workUnitId: "WU-4", workUnit: workUnit() });
    const note = renderExecutionGuidancePromptNote(guidance);
    expect(note).toMatch(/follow the generated execution guidance/i);
    expect(note).toMatch(/only when evidence shows it is insufficient/i);
    expect(note).toMatch(/not.*investigate.*broadly/i);
  });

  it("ExecutionGuidance round-trips losslessly through JSON (JSON surface compatibility)", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "WU-5",
      workUnit: workUnit(),
      profileConfig: { agentClassProfiles: { balanced: { medium: { agent: "Claude Code", model: "Sonnet 5", effort: "medium" } } } },
      contextManifestInput: { suggestedFiles: ["src/a.ts"] },
      continuationInput: { directDependencies: [] },
    });
    const roundTripped = JSON.parse(JSON.stringify(guidance));
    expect(roundTripped).toEqual(guidance);
  });
});
