import { describe, it, expect } from "vitest";
import { sortAndAssignFindingIds } from "../../src/workflow/review-findings.js";
import type { ReviewFindingCandidate } from "../../src/workflow/review-rules.js";

function candidate(overrides: Partial<ReviewFindingCandidate>): ReviewFindingCandidate {
  return {
    ruleKey: "z",
    category: "workflow",
    severity: "medium",
    blocking: false,
    title: "t",
    message: "m",
    relatedIds: [],
    suggestedAction: "a",
    nextRecommendedCommand: null,
    ...overrides,
  };
}

describe("sortAndAssignFindingIds", () => {
  it("assigns sequential FIND-### ids starting at FIND-001", () => {
    const result = sortAndAssignFindingIds([
      candidate({ ruleKey: "a" }),
      candidate({ ruleKey: "b" }),
    ]);
    expect(result.map((f) => f.id)).toEqual(["FIND-001", "FIND-002"]);
  });

  it("sorts blocking findings before non-blocking findings", () => {
    const result = sortAndAssignFindingIds([
      candidate({ ruleKey: "non-blocking", blocking: false, severity: "critical" }),
      candidate({ ruleKey: "blocking", blocking: true, severity: "low" }),
    ]);
    expect(result[0].blocking).toBe(true);
    expect(result[1].blocking).toBe(false);
  });

  it("sorts by severity (critical before high before medium) within the same blocking group", () => {
    const result = sortAndAssignFindingIds([
      candidate({ ruleKey: "medium", severity: "medium" }),
      candidate({ ruleKey: "critical", severity: "critical" }),
      candidate({ ruleKey: "high", severity: "high" }),
    ]);
    expect(result.map((f) => f.severity)).toEqual(["critical", "high", "medium"]);
  });

  it("falls back to category, then relatedIds, then ruleKey for stable ordering", () => {
    const a = candidate({ ruleKey: "a", category: "quality", relatedIds: ["WU001"] });
    const b = candidate({ ruleKey: "b", category: "context", relatedIds: ["WU001"] });
    const result = sortAndAssignFindingIds([a, b]);
    expect(result[0].category).toBe("context");
    expect(result[1].category).toBe("quality");
  });

  it("strips the internal ruleKey field from the output", () => {
    const result = sortAndAssignFindingIds([candidate({ ruleKey: "internal-only" })]);
    expect(result[0]).not.toHaveProperty("ruleKey");
  });

  it("produces the same ordering regardless of input order (deterministic)", () => {
    const items = [
      candidate({ ruleKey: "c1", blocking: true, severity: "high" }),
      candidate({ ruleKey: "c2", blocking: false, severity: "info" }),
      candidate({ ruleKey: "c3", blocking: true, severity: "critical" }),
    ];
    const forward = sortAndAssignFindingIds(items).map((f) => f.title + f.severity);
    const reversed = sortAndAssignFindingIds([...items].reverse()).map(
      (f) => f.title + f.severity,
    );
    expect(forward).toEqual(reversed);
  });
});
