import { describe, it, expect } from "vitest";
import { deriveFinalWorkUnitStatus } from "../../src/workflow/checkpoint-completion-gate.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import type { CheckpointInput } from "../../src/schema/checkpoint-input.schema.js";

function baseInput(overrides: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    summary: "Did the thing.",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [],
    acceptanceCriteria: [],
    issues: [],
    notes: [],
    ...overrides,
  };
}

describe("deriveFinalWorkUnitStatus: derivation (targetStatus omitted)", () => {
  it("derives done when all completion conditions are satisfied", () => {
    expect(deriveFinalWorkUnitStatus(baseInput())).toBe("done");
  });

  it("derives needs_review when validationResult is not passed", () => {
    expect(deriveFinalWorkUnitStatus(baseInput({ validationResult: "failed" }))).toBe(
      "needs_review",
    );
  });

  it("derives needs_review when acceptanceCriteriaResult is not passed", () => {
    expect(
      deriveFinalWorkUnitStatus(baseInput({ acceptanceCriteriaResult: "partial" })),
    ).toBe("needs_review");
  });

  it("derives needs_review when notCompleted has items", () => {
    expect(
      deriveFinalWorkUnitStatus(baseInput({ notCompleted: ["remaining work"] })),
    ).toBe("needs_review");
  });

  it("derives needs_review when an open high-severity issue exists", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "high" }],
    });
    expect(deriveFinalWorkUnitStatus(input)).toBe("needs_review");
  });

  it("derives needs_review when an open critical-severity issue exists", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "critical", status: "open" }],
    });
    expect(deriveFinalWorkUnitStatus(input)).toBe("needs_review");
  });

  it("derives done when a high-severity issue is resolved", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "high", status: "resolved" }],
    });
    expect(deriveFinalWorkUnitStatus(input)).toBe("done");
  });

  it("derives done when only low/medium issues exist", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "low" }, { title: "u", severity: "medium" }],
    });
    expect(deriveFinalWorkUnitStatus(input)).toBe("done");
  });
});

describe("deriveFinalWorkUnitStatus: explicit targetStatus", () => {
  it("always allows explicit targetStatus = needs_review", () => {
    const input = baseInput({ targetStatus: "needs_review", validationResult: "failed" });
    expect(deriveFinalWorkUnitStatus(input)).toBe("needs_review");
  });

  it("accepts explicit targetStatus = done when the gate passes", () => {
    expect(deriveFinalWorkUnitStatus(baseInput({ targetStatus: "done" }))).toBe("done");
  });

  it("rejects targetStatus = done with validationResult != passed (exit 1)", () => {
    const input = baseInput({ targetStatus: "done", validationResult: "failed" });
    try {
      deriveFinalWorkUnitStatus(input);
      expect.fail("expected AiqtError");
    } catch (err) {
      expect(err).toBeInstanceOf(AiqtError);
      expect((err as AiqtError).exitCode).toBe(ExitCode.ValidationFailed);
      expect((err as AiqtError).issue?.area).toBe("checkpoint");
      expect((err as AiqtError).issue?.suggestedAction).toBe(
        "Correct the checkpoint input and rerun aiqt checkpoint.",
      );
    }
  });

  it("rejects targetStatus = done with acceptanceCriteriaResult != passed (exit 1)", () => {
    const input = baseInput({ targetStatus: "done", acceptanceCriteriaResult: "failed" });
    expect(() => deriveFinalWorkUnitStatus(input)).toThrow(AiqtError);
  });

  it("rejects targetStatus = done with notCompleted entries (exit 1)", () => {
    const input = baseInput({ targetStatus: "done", notCompleted: ["x"] });
    expect(() => deriveFinalWorkUnitStatus(input)).toThrow(AiqtError);
  });

  it("rejects targetStatus = done with an open critical issue (exit 1)", () => {
    const input = baseInput({
      targetStatus: "done",
      issues: [{ title: "t", severity: "critical" }],
    });
    expect(() => deriveFinalWorkUnitStatus(input)).toThrow(AiqtError);
  });
});
