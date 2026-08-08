import { describe, it, expect } from "vitest";
import { computeTestSelectionReduction, computeMultiWorkUnitSelectionEfficiency } from "../../src/workflow/test-impact-efficiency-evidence.js";

describe("computeTestSelectionReduction: honest, never-negative, never-fabricated ratio", () => {
  it("computes the real reduction ratio", () => {
    const result = computeTestSelectionReduction({ candidateCount: 100, selectedCount: 20 });
    expect(result.reductionRatio).toBeCloseTo(0.8);
    expect(result.meetsThirtyPercentTarget).toBe(true);
  });

  it("reports below-target honestly rather than gaming the number", () => {
    const result = computeTestSelectionReduction({ candidateCount: 100, selectedCount: 90 });
    expect(result.reductionRatio).toBeCloseTo(0.1);
    expect(result.meetsThirtyPercentTarget).toBe(false);
  });

  it("never goes negative when selected exceeds candidate (a caller error, not a fabricated negative reduction)", () => {
    const result = computeTestSelectionReduction({ candidateCount: 10, selectedCount: 20 });
    expect(result.reductionRatio).toBe(0);
  });

  it("returns 0/false when there is nothing to reduce from", () => {
    const result = computeTestSelectionReduction({ candidateCount: 0, selectedCount: 0 });
    expect(result.reductionRatio).toBe(0);
    expect(result.meetsThirtyPercentTarget).toBe(false);
  });
});

describe("computeMultiWorkUnitSelectionEfficiency: aggregates a real multi-WU flow", () => {
  it("sums candidate/selected counts across Work Units and reuses the same honest ratio math", () => {
    const result = computeMultiWorkUnitSelectionEfficiency([
      { workUnitId: "wu-1", candidateCount: 8, selectedCount: 2 },
      { workUnitId: "wu-2", candidateCount: 8, selectedCount: 3 },
    ]);
    expect(result.totalCandidateExecutions).toBe(16);
    expect(result.totalSelectedExecutions).toBe(5);
    expect(result.reductionRatio).toBeCloseTo(1 - 5 / 16);
    expect(result.perWorkUnit).toHaveLength(2);
  });
});
