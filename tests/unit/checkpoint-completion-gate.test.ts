import { describe, it, expect } from "vitest";
import { deriveFinalWorkUnitStatus } from "../../src/workflow/checkpoint-completion-gate.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import type { CheckpointInput } from "../../src/schema/checkpoint-input.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";

const workUnit = (overrides: Partial<Pick<WorkUnit, "validationCommands" | "acceptanceCriteria">> = {}) => ({
  validationCommands: [],
  acceptanceCriteria: [],
  ...overrides,
});

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
    expect(deriveFinalWorkUnitStatus(workUnit(), baseInput())).toBe("done");
  });

  it("derives needs_review when validationResult is not passed", () => {
    expect(deriveFinalWorkUnitStatus(workUnit(), baseInput({ validationResult: "failed" }))).toBe(
      "needs_review",
    );
  });

  it("derives needs_review when acceptanceCriteriaResult is not passed", () => {
    expect(
      deriveFinalWorkUnitStatus(workUnit(), baseInput({ acceptanceCriteriaResult: "partial" })),
    ).toBe("needs_review");
  });

  it("derives needs_review when notCompleted has items", () => {
    expect(
      deriveFinalWorkUnitStatus(workUnit(), baseInput({ notCompleted: ["remaining work"] })),
    ).toBe("needs_review");
  });

  it("derives needs_review when an open high-severity issue exists", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "high" }],
    });
    expect(deriveFinalWorkUnitStatus(workUnit(), input)).toBe("needs_review");
  });

  it("derives needs_review when an open critical-severity issue exists", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "critical", status: "open" }],
    });
    expect(deriveFinalWorkUnitStatus(workUnit(), input)).toBe("needs_review");
  });

  it("derives done when a high-severity issue is resolved", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "high", status: "resolved" }],
    });
    expect(deriveFinalWorkUnitStatus(workUnit(), input)).toBe("done");
  });

  it("derives done when only low/medium issues exist", () => {
    const input = baseInput({
      issues: [{ title: "t", severity: "low" }, { title: "u", severity: "medium" }],
    });
    expect(deriveFinalWorkUnitStatus(workUnit(), input)).toBe("done");
  });
});

describe("deriveFinalWorkUnitStatus: explicit targetStatus", () => {
  it("always allows explicit targetStatus = needs_review", () => {
    const input = baseInput({ targetStatus: "needs_review", validationResult: "failed" });
    expect(deriveFinalWorkUnitStatus(workUnit(), input)).toBe("needs_review");
  });

  it("accepts explicit targetStatus = done when the gate passes", () => {
    expect(deriveFinalWorkUnitStatus(workUnit(), baseInput({ targetStatus: "done" }))).toBe("done");
  });

  it("rejects targetStatus = done with validationResult != passed (exit 1)", () => {
    const input = baseInput({ targetStatus: "done", validationResult: "failed" });
    try {
      deriveFinalWorkUnitStatus(workUnit(), input);
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
    expect(() => deriveFinalWorkUnitStatus(workUnit(), input)).toThrow(AiqtError);
  });

  it("rejects targetStatus = done with notCompleted entries (exit 1)", () => {
    const input = baseInput({ targetStatus: "done", notCompleted: ["x"] });
    expect(() => deriveFinalWorkUnitStatus(workUnit(), input)).toThrow(AiqtError);
  });

  it("rejects targetStatus = done with an open critical issue (exit 1)", () => {
    const input = baseInput({
      targetStatus: "done",
      issues: [{ title: "t", severity: "critical" }],
    });
    expect(() => deriveFinalWorkUnitStatus(workUnit(), input)).toThrow(AiqtError);
  });

  it("does not let an aggregate pass hide a required detailed failure", () => {
    expect(deriveFinalWorkUnitStatus(workUnit({ validationCommands: ["pnpm test"] }), baseInput({
      validationCommands: [{ command: "pnpm test", result: "failed", summary: null }],
    }))).toBe("needs_review");
  });

  it("does not let an unassessed required item become success", () => {
    expect(deriveFinalWorkUnitStatus(workUnit({ acceptanceCriteria: ["Works"] }), baseInput())).toBe("needs_review");
  });
});
