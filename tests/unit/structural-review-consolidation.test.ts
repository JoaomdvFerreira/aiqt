import { describe, it, expect } from "vitest";
import { consolidateFindings, suppressKnownBenignFindings } from "../../src/workflow/structural-review-consolidation.js";
import type { StructuralFinding } from "../../src/schema/structural-review.schema.js";

const COMMIT = "d".repeat(40);

function makeFinding(overrides: Partial<StructuralFinding> = {}): StructuralFinding {
  return {
    findingKey: "sha256:" + "a".repeat(64),
    domain: "ownership_divergence",
    ruleId: "r1",
    title: "t",
    explanation: "e",
    reviewCommit: COMMIT,
    affectedPaths: ["src/a.ts"],
    evidence: [{ evidenceId: "E1", description: "d", locator: "src/a.ts" }],
    confidence: "proven",
    significance: "medium",
    reasonCodes: ["X"],
    evidenceGaps: [],
    disposition: "actionable",
    eligibleForIntake: true,
    recommendedNextAction: "fix it",
    providerSource: "repository-local",
    ...overrides,
  };
}

describe("consolidateFindings", () => {
  it("passes through unrelated findings unchanged", () => {
    const a = makeFinding({ findingKey: "sha256:" + "a".repeat(64) });
    const b = makeFinding({ findingKey: "sha256:" + "b".repeat(64) });
    const result = consolidateFindings([a, b]);
    expect(result).toHaveLength(2);
  });

  it("merges two findings with the same findingKey, preserving evidence provenance", () => {
    const a = makeFinding({
      providerSource: "repository-local",
      evidence: [{ evidenceId: "E1", description: "from rule A", locator: "src/a.ts" }],
    });
    const b = makeFinding({
      providerSource: "graphify",
      evidence: [{ evidenceId: "E2", description: "from provider B", locator: "src/a.ts" }],
      affectedPaths: ["src/b.ts"],
    });
    const [merged] = consolidateFindings([a, b]);
    expect(consolidateFindings([a, b])).toHaveLength(1);
    expect(merged.evidence.map((e) => e.evidenceId).sort()).toEqual(["E1", "E2"]);
    expect(merged.consolidatedFrom?.sort()).toEqual(["graphify", "repository-local"]);
    expect(merged.affectedPaths.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("does not merge findings with different findingKeys, even with similar titles", () => {
    const a = makeFinding({ findingKey: "sha256:" + "a".repeat(64), title: "Duplicate owner in module X" });
    const b = makeFinding({ findingKey: "sha256:" + "b".repeat(64), title: "Duplicate owner in module Y" });
    expect(consolidateFindings([a, b])).toHaveLength(2);
  });

  it("does not duplicate evidence with the same evidenceId across merges", () => {
    const a = makeFinding({ evidence: [{ evidenceId: "E1", description: "x", locator: "src/a.ts" }] });
    const b = makeFinding({ evidence: [{ evidenceId: "E1", description: "x", locator: "src/a.ts" }] });
    const [merged] = consolidateFindings([a, b]);
    expect(merged.evidence).toHaveLength(1);
  });
});

describe("suppressKnownBenignFindings", () => {
  it("suppresses a finding whose only affected paths are archived milestone documents", () => {
    const finding = makeFinding({ affectedPaths: ["docs/archive/milestones/m35/m35-test-suite-inventory.md"] });
    const [result] = suppressKnownBenignFindings([finding]);
    expect(result.disposition).toBe("suppressed_benign_pattern");
    expect(result.eligibleForIntake).toBe(false);
  });

  it("suppresses a finding whose only affected path is a legacy compatibility test", () => {
    const finding = makeFinding({ affectedPaths: ["tests/integration/execution-adapter-claude-code-legacy-compat.test.ts"] });
    const [result] = suppressKnownBenignFindings([finding]);
    expect(result.disposition).toBe("suppressed_benign_pattern");
  });

  it("does not suppress a finding touching a live, non-archived path", () => {
    const finding = makeFinding({ affectedPaths: ["src/cli/commands/foo.command.ts"] });
    const [result] = suppressKnownBenignFindings([finding]);
    expect(result.disposition).toBe("actionable");
    expect(result.eligibleForIntake).toBe(true);
  });

  it("does not suppress a finding with a mix of benign and live paths", () => {
    const finding = makeFinding({ affectedPaths: ["docs/archive/milestones/m35/m35-test-suite-inventory.md", "src/live.ts"] });
    const [result] = suppressKnownBenignFindings([finding]);
    expect(result.disposition).toBe("actionable");
  });
});
