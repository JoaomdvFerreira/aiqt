import { describe, it, expect } from "vitest";
import { selectTestImpactWithFeedback } from "../../src/workflow/test-impact-adaptive-selection.js";
import type { TestImpactInput, TestInventorySnapshot, ValidationFeedbackRef } from "../../src/schema/test-impact.schema.js";

const inventory: TestInventorySnapshot = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  entries: [
    { path: "tests/unit/foo.test.ts", layer: "unit", domain: "d", criticality: "Normal" },
    { path: "tests/unit/bar.test.ts", layer: "unit", domain: "d", criticality: "Normal" },
  ],
};

function baseInput(overrides: Partial<TestImpactInput> = {}): TestImpactInput {
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

function fb(overrides: Partial<ValidationFeedbackRef> = {}): ValidationFeedbackRef {
  return {
    targetId: "test_file:tests/unit/bar.test.ts",
    outcome: "failed",
    workUnitId: "wu-1",
    changeIdentity: "wu-1",
    durationMs: null,
    failureCategory: null,
    evidenceTimestamp: "2026-01-01T00:00:00.000Z",
    evidenceSource: "checkpoint:c1",
    ...overrides,
  };
}

describe("selectTestImpactWithFeedback: stale feedback cannot influence selection (build spec Sec 10)", () => {
  it("a mismatched changeIdentity is rejected and never promotes its target", () => {
    const result = selectTestImpactWithFeedback(baseInput({ priorFeedback: [fb({ changeIdentity: "some-other-change" })] }));
    expect(result.trustedFeedbackCount).toBe(0);
    expect(result.rejectedFeedback).toHaveLength(1);
    expect(result.selection.selectedTargets.find((t) => t.target.id === "test_file:tests/unit/bar.test.ts")).toBeUndefined();
  });

  it("currentChangeIdentity defaults to workUnitId when not explicitly supplied", () => {
    const result = selectTestImpactWithFeedback(baseInput({ priorFeedback: [fb({ changeIdentity: "wu-1" })] }));
    expect(result.trustedFeedbackCount).toBe(1);
  });
});

describe("selectTestImpactWithFeedback: prior relevant failure promotion and broadened escalation", () => {
  it("a trusted failure promotes its target and downgrades a clean 'selected_focused' escalation to 'broaden_required'", () => {
    const result = selectTestImpactWithFeedback(baseInput({ changedFiles: ["tests/unit/foo.test.ts"], priorFeedback: [fb()] }));
    expect(result.trustedFeedbackCount).toBe(1);
    expect(result.selection.selectedTargets.find((t) => t.target.id === "test_file:tests/unit/bar.test.ts")).toBeDefined();
    expect(result.selection.escalation).toBe("broaden_required");
  });

  it("a passed prior outcome never suppresses or downgrades anything", () => {
    const result = selectTestImpactWithFeedback(baseInput({ changedFiles: ["tests/unit/foo.test.ts"], priorFeedback: [fb({ outcome: "passed" })] }));
    expect(result.selection.escalation).toBe("selected_focused");
  });
});

describe("selectTestImpactWithFeedback: duration/history only reorders, never removes required coverage", () => {
  it("mandatory targets always stay first regardless of duration/failure ordering signals", () => {
    const result = selectTestImpactWithFeedback(
      baseInput({
        explicitValidationCommands: ["pnpm typecheck"],
        changedFiles: ["tests/unit/foo.test.ts"],
        priorFeedback: [fb()],
      }),
    );
    expect(result.selection.selectedTargets[0]?.mandatory).toBe(true);
    expect(result.selection.mandatoryTargetIds).toContain("validation_command:pnpm typecheck");
  });

  it("a target with known shorter duration orders before one with a longer known duration, among non-mandatory targets", () => {
    const result = selectTestImpactWithFeedback(
      baseInput({
        changedFiles: ["tests/unit/foo.test.ts", "tests/unit/bar.test.ts"],
        priorFeedback: [
          fb({ targetId: "test_file:tests/unit/foo.test.ts", outcome: "passed", durationMs: 500 }),
          fb({ targetId: "test_file:tests/unit/bar.test.ts", outcome: "passed", durationMs: 50 }),
        ],
      }),
    );
    const ids = result.selection.selectedTargets.map((t) => t.target.id);
    expect(ids.indexOf("test_file:tests/unit/bar.test.ts")).toBeLessThan(ids.indexOf("test_file:tests/unit/foo.test.ts"));
  });

  it("order is deterministic for identical inputs", () => {
    const input = baseInput({ changedFiles: ["tests/unit/foo.test.ts"], priorFeedback: [fb()] });
    const a = selectTestImpactWithFeedback(input);
    const b = selectTestImpactWithFeedback({ ...input });
    expect(a.selection).toEqual(b.selection);
  });
});
