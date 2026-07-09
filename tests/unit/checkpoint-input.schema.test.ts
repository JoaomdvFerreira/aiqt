import { describe, it, expect } from "vitest";
import { CheckpointInputSchema } from "../../src/schema/checkpoint-input.schema.js";

function validMinimal() {
  return {
    summary: "Did the thing.",
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
  };
}

describe("CheckpointInputSchema", () => {
  it("validates a minimal valid input, defaulting optional fields", () => {
    const parsed = CheckpointInputSchema.safeParse(validMinimal());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.completed).toEqual([]);
      expect(parsed.data.notCompleted).toEqual([]);
      expect(parsed.data.filesChanged).toEqual([]);
      expect(parsed.data.validationCommands).toEqual([]);
      expect(parsed.data.acceptanceCriteria).toEqual([]);
      expect(parsed.data.issues).toEqual([]);
      expect(parsed.data.notes).toEqual([]);
      expect(parsed.data.targetStatus).toBeUndefined();
    }
  });

  it("validates a fully populated input", () => {
    const input = {
      ...validMinimal(),
      completed: ["a"],
      notCompleted: [],
      filesChanged: ["src/x.ts"],
      validationCommands: [{ command: "pnpm test", result: "passed", summary: "ok" }],
      acceptanceCriteria: [{ criterion: "works", result: "passed", evidence: "test" }],
      issues: [{ title: "minor", severity: "low" }],
      targetStatus: "done",
      notes: ["note"],
    };
    expect(CheckpointInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects a missing required summary", () => {
    const input = validMinimal() as Record<string, unknown>;
    delete input.summary;
    expect(CheckpointInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an empty summary", () => {
    const input = { ...validMinimal(), summary: "" };
    expect(CheckpointInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an invalid validationResult enum value", () => {
    const input = { ...validMinimal(), validationResult: "unknown" };
    expect(CheckpointInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an invalid targetStatus enum value", () => {
    const input = { ...validMinimal(), targetStatus: "cancelled" };
    expect(CheckpointInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const input = { ...validMinimal(), extra: true };
    expect(CheckpointInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown nested keys in a validation command", () => {
    const input = {
      ...validMinimal(),
      validationCommands: [{ command: "pnpm test", result: "passed", extra: true }],
    };
    expect(CheckpointInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown nested keys in an issue", () => {
    const input = {
      ...validMinimal(),
      issues: [{ title: "t", severity: "low", extra: true }],
    };
    expect(CheckpointInputSchema.safeParse(input).success).toBe(false);
  });

  it("defaults issue status/agentCanFix when omitted at the input level", () => {
    const input = { ...validMinimal(), issues: [{ title: "t", severity: "high" }] };
    const parsed = CheckpointInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.issues[0].status).toBeUndefined();
      expect(parsed.data.issues[0].agentCanFix).toBeUndefined();
    }
  });
});
