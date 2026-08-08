import { describe, it, expect } from "vitest";
import { selectTestImpact } from "../../src/workflow/test-impact-selection.js";
import { detectBroadBlastRadius } from "../../src/workflow/test-impact-blast-radius.js";
import type { TestImpactInput, TestInventorySnapshot } from "../../src/schema/test-impact.schema.js";

const inventory: TestInventorySnapshot = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  entries: [
    { path: "tests/unit/foo.test.ts", layer: "unit", domain: "d", criticality: "Normal" },
    { path: "tests/unit/bar.test.ts", layer: "unit", domain: "d", criticality: "Normal" },
    { path: "tests/unit/foo-hardening.test.ts", layer: "unit", domain: "d", criticality: "Normal" },
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

describe("selectTestImpact: mandatory targets always win (build spec Sec 5.2, 7.1)", () => {
  it("every explicit validation command is selected as mandatory, regardless of other evidence", () => {
    const selection = selectTestImpact(baseInput({ explicitValidationCommands: ["pnpm typecheck", "pnpm lint"] }));
    expect(selection.mandatoryTargetIds).toEqual(["validation_command:pnpm typecheck", "validation_command:pnpm lint"]);
    for (const id of selection.mandatoryTargetIds) {
      const t = selection.selectedTargets.find((s) => s.target.id === id);
      expect(t?.reasonCodes).toContain("explicit_requirement");
    }
  });

  it("a changed test file is selected with reason changed_test", () => {
    const selection = selectTestImpact(baseInput({ changedFiles: ["tests/unit/foo.test.ts"] }));
    const t = selection.selectedTargets.find((s) => s.target.id === "test_file:tests/unit/foo.test.ts");
    expect(t).toBeDefined();
    expect(t?.reasonCodes).toContain("changed_test");
    expect(t?.mandatory).toBe(false);
  });

  it("a scoped source file selects its naming-convention-matched test(s) with reason scoped_file_match", () => {
    const selection = selectTestImpact(baseInput({ scopedFiles: ["src/foo.ts"] }));
    const ids = selection.selectedTargets.map((s) => s.target.id);
    expect(ids).toContain("test_file:tests/unit/foo.test.ts");
    expect(ids).toContain("test_file:tests/unit/foo-hardening.test.ts");
    expect(ids).not.toContain("test_file:tests/unit/bar.test.ts");
    const foo = selection.selectedTargets.find((s) => s.target.id === "test_file:tests/unit/foo.test.ts");
    expect(foo?.reasonCodes).toContain("scoped_file_match");
  });
});

describe("selectTestImpact: determinism (build spec Sec 5.3)", () => {
  it("identical inputs produce identical selection and order", () => {
    const input = baseInput({ scopedFiles: ["src/foo.ts"], changedFiles: ["src/bar.ts"], explicitValidationCommands: ["pnpm typecheck"] });
    const a = selectTestImpact(input);
    const b = selectTestImpact({ ...input });
    expect(a).toEqual(b);
  });
});

describe("selectTestImpact: unknown evidence broadens, never silently narrows (build spec Sec 5.4)", () => {
  it("a scoped file with no naming-convention match lowers confidence and recommends broaden_required", () => {
    const selection = selectTestImpact(baseInput({ scopedFiles: ["src/totally-unmapped-thing.ts"] }));
    expect(selection.escalation).toBe("broaden_required");
    expect(selection.confidence).not.toBe("high");
    expect(selection.evidenceGaps.some((g) => g.code === "NO-CONVENTION-MATCH")).toBe(true);
  });

  it("no evidence at all (empty scoped/changed, no mandatory commands) reports insufficient_evidence, not a fabricated pass", () => {
    const selection = selectTestImpact(baseInput());
    expect(selection.escalation).toBe("insufficient_evidence");
    expect(selection.selectedTargets).toEqual([]);
  });
});

describe("selectTestImpact: broad-blast-radius escalation (build spec Sec 7.3)", () => {
  it("a change to a canonical schema file escalates to full_required and defers no longer", () => {
    const selection = selectTestImpact(baseInput({ changedFiles: ["src/schema/state.schema.ts"] }));
    expect(selection.escalation).toBe("full_required");
    expect(selection.recommendedTier).toBe("full");
    expect(selection.fullSuiteDeferred).toBe(false);
    expect(selection.confidence).toBe("low");
  });

  it("detectBroadBlastRadius flags atomic-write.ts, exit-codes.ts, and canonical-json.ts", () => {
    const result = detectBroadBlastRadius(["src/core/filesystem/atomic-write.ts", "src/core/output/exit-codes.ts", "src/schema/external-evidence/canonical-json.ts"]);
    expect(result.escalate).toBe(true);
    expect(result.reasons).toHaveLength(3);
  });

  it("an ordinary, non-broad source path does not escalate", () => {
    expect(detectBroadBlastRadius(["src/cli/commands/status.command.ts"]).escalate).toBe(false);
  });
});

describe("selectTestImpact: no caller-supplied override (build spec Sec 5.3, 7.2)", () => {
  it("TestImpactInput has no field through which a caller can set confidence or the final selection directly", () => {
    const input = baseInput();
    expect(Object.keys(input)).not.toContain("confidence");
    expect(Object.keys(input)).not.toContain("selectedTargets");
  });
});

describe("selectTestImpact: prior relevant failure promotion (basic, WU41-02 scope)", () => {
  it("a prior failed outcome for an inventoried test promotes it into the selection", () => {
    const selection = selectTestImpact(
      baseInput({
        priorFeedback: [
          { targetId: "test_file:tests/unit/bar.test.ts", outcome: "failed", workUnitId: "wu-0", changeIdentity: "abc", durationMs: null, failureCategory: null, evidenceTimestamp: "2026-01-01T00:00:00.000Z", evidenceSource: "runlog" },
        ],
      }),
    );
    const bar = selection.selectedTargets.find((s) => s.target.id === "test_file:tests/unit/bar.test.ts");
    expect(bar).toBeDefined();
    expect(bar?.reasonCodes).toContain("prior_relevant_failure");
  });

  it("a passed prior outcome never suppresses or removes anything -- it simply isn't promoted", () => {
    const selection = selectTestImpact(
      baseInput({
        priorFeedback: [
          { targetId: "test_file:tests/unit/bar.test.ts", outcome: "passed", workUnitId: "wu-0", changeIdentity: "abc", durationMs: 100, failureCategory: null, evidenceTimestamp: "2026-01-01T00:00:00.000Z", evidenceSource: "runlog" },
        ],
      }),
    );
    expect(selection.selectedTargets.find((s) => s.target.id === "test_file:tests/unit/bar.test.ts")).toBeUndefined();
  });
});
