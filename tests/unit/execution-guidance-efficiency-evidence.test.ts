import { describe, it, expect } from "vitest";
import { computeContextFootprintReduction, computeContinuationCompactness } from "../../src/workflow/execution-guidance-efficiency-evidence.js";

describe("execution-guidance-efficiency-evidence (M39-WU05)", () => {
  it("computes an honest reduction ratio, not a target-seeking one", () => {
    const result = computeContextFootprintReduction({ baselineEstimatedTokens: 1000, actualEstimatedTokens: 600 });
    expect(result.reductionRatio).toBeCloseTo(0.4, 5);
    expect(result.meetsThirtyPercentTarget).toBe(true);
  });

  it("reports below-target honestly rather than inflating it", () => {
    const result = computeContextFootprintReduction({ baselineEstimatedTokens: 1000, actualEstimatedTokens: 900 });
    expect(result.reductionRatio).toBeCloseTo(0.1, 5);
    expect(result.meetsThirtyPercentTarget).toBe(false);
  });

  it("never reports a negative reduction when actual exceeds baseline", () => {
    const result = computeContextFootprintReduction({ baselineEstimatedTokens: 100, actualEstimatedTokens: 200 });
    expect(result.reductionRatio).toBe(0);
  });

  it("returns 0 (not a divide-by-zero artifact) when baseline is zero", () => {
    expect(computeContextFootprintReduction({ baselineEstimatedTokens: 0, actualEstimatedTokens: 0 }).reductionRatio).toBe(0);
  });

  it("computes continuation compactness against raw upstream checkpoint size", () => {
    expect(computeContinuationCompactness({ rawUpstreamCheckpointCharCount: 1000, capsuleCharCount: 200 })).toBeCloseTo(0.8, 5);
  });
});
