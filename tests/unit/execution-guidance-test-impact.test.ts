import { describe, it, expect } from "vitest";
import { buildValidationGuidance, composeExecutionGuidance } from "../../src/workflow/execution-guidance.js";
import { renderExecutionGuidanceHuman, renderTestImpactExplain } from "../../src/workflow/execution-guidance-render.js";
import type { TestImpactInput, TestInventorySnapshot } from "../../src/schema/test-impact.schema.js";

const inventory: TestInventorySnapshot = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  entries: [{ path: "tests/unit/foo.test.ts", layer: "unit", domain: "d", criticality: "Normal" }],
};

function testImpactInput(overrides: Partial<TestImpactInput> = {}): TestImpactInput {
  return {
    workUnitId: "wu-1",
    scopedFiles: [],
    changedFiles: [],
    explicitValidationCommands: [],
    inventory,
    priorFeedback: [],
    ...overrides,
  };
}

describe("buildValidationGuidance: test-impact integration (M41-WU03, build spec Sec 8)", () => {
  it("testImpact is null when no test-impact input is supplied (pre-M41 behavior preserved)", () => {
    const validation = buildValidationGuidance({});
    expect(validation.testImpact).toBeNull();
  });

  it("testImpact is null for milestone closure -- always full regardless of selection", () => {
    const validation = buildValidationGuidance({ isMilestoneClosure: true, testImpactInput: testImpactInput({ scopedFiles: ["src/foo.ts"] }) });
    expect(validation.testImpact).toBeNull();
    expect(validation.requiredNow.map((s) => s.tier)).toEqual(["milestone", "full"]);
  });

  it("a broad-blast-radius test-impact input ADDS a full requiredNow step without removing the existing static/focused defaults", () => {
    const validation = buildValidationGuidance({ testImpactInput: testImpactInput({ changedFiles: ["src/schema/state.schema.ts"] }) });
    const tiers = validation.requiredNow.map((s) => s.tier);
    expect(tiers).toContain("static");
    expect(tiers).toContain("full");
    expect(validation.testImpact?.escalation).toBe("full_required");
  });

  it("an insufficient-evidence test-impact input ADDS an impacted requiredNow step, never removes explicit commands", () => {
    const validation = buildValidationGuidance({
      explicitValidationCommands: ["pnpm typecheck"],
      testImpactInput: testImpactInput({ scopedFiles: ["src/totally-unmapped.ts"] }),
    });
    const tiers = validation.requiredNow.map((s) => s.tier);
    expect(tiers).toContain("static"); // from classifyValidationCommand("pnpm typecheck")
    expect(tiers).toContain("impacted"); // added by test-impact broadening
    expect(validation.testImpact?.escalation).toBe("broaden_required");
  });

  it("a clean, well-matched test-impact input does not force an extra requiredNow step beyond the existing default", () => {
    const validation = buildValidationGuidance({ testImpactInput: testImpactInput({ changedFiles: ["tests/unit/foo.test.ts"] }) });
    expect(validation.requiredNow.map((s) => s.tier)).toEqual(["static", "focused"]);
    expect(validation.testImpact?.escalation).toBe("selected_focused");
  });
});

describe("composeExecutionGuidance: threads testImpactInput through to validation.testImpact", () => {
  it("is present end-to-end when supplied", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "wu-1",
      workUnit: { objective: "x", scope: [], outOfScope: [], acceptanceCriteria: [], suggestedFiles: [], dependencies: [] },
      testImpactInput: testImpactInput({ changedFiles: ["tests/unit/foo.test.ts"] }),
    });
    expect(guidance.validation.testImpact).not.toBeNull();
    expect(guidance.validation.testImpact?.selectedTargets.length).toBeGreaterThan(0);
  });
});

describe("renderExecutionGuidanceHuman: compact test-impact line (M41-WU03)", () => {
  it("adds a compact 'Test impact:' line when testImpact is present", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "wu-1",
      workUnit: { objective: "x", scope: [], outOfScope: [], acceptanceCriteria: [], suggestedFiles: [], dependencies: [] },
      testImpactInput: testImpactInput({ changedFiles: ["tests/unit/foo.test.ts"] }),
    });
    const rendered = renderExecutionGuidanceHuman(guidance);
    expect(rendered).toMatch(/^Test impact: /m);
  });

  it("omits the test-impact line entirely when no test-impact input was supplied", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "wu-1",
      workUnit: { objective: "x", scope: [], outOfScope: [], acceptanceCriteria: [], suggestedFiles: [], dependencies: [] },
    });
    expect(renderExecutionGuidanceHuman(guidance)).not.toMatch(/Test impact:/);
  });
});

describe("renderTestImpactExplain: richer per-target view (M41-WU03, build spec Sec 9)", () => {
  it("lists selected targets, reason codes, and reasons", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "wu-1",
      workUnit: { objective: "x", scope: [], outOfScope: [], acceptanceCriteria: [], suggestedFiles: [], dependencies: [] },
      testImpactInput: testImpactInput({ changedFiles: ["tests/unit/foo.test.ts"] }),
    });
    const explain = renderTestImpactExplain(guidance);
    expect(explain).toContain("tests/unit/foo.test.ts");
    expect(explain).toContain("changed_test");
  });

  it("returns an honest message when no test-impact input was supplied, never a fabricated selection", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "wu-1",
      workUnit: { objective: "x", scope: [], outOfScope: [], acceptanceCriteria: [], suggestedFiles: [], dependencies: [] },
    });
    expect(renderTestImpactExplain(guidance)).toMatch(/no test-impact input was supplied/i);
  });
});
