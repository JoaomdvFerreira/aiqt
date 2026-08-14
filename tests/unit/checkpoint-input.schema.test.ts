import { describe, it, expect } from "vitest";
import { CheckpointInputSchema } from "../../src/schema/checkpoint-input.schema.js";
import { CheckpointSchema } from "../../src/schema/checkpoint.schema.js";

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

  it("accepts an explicit progress disposition without a terminal status", () => {
    const parsed = CheckpointInputSchema.safeParse({
      ...validMinimal(),
      disposition: "progress",
      notCompleted: ["Complete the remaining batch."],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a terminal targetStatus on a progress checkpoint", () => {
    expect(CheckpointInputSchema.safeParse({
      ...validMinimal(),
      disposition: "progress",
      targetStatus: "done",
    }).success).toBe(false);
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

describe("CheckpointSchema dispositions", () => {
  function storedCheckpoint(overrides: Record<string, unknown> = {}) {
    return {
      id: "C001",
      workUnitId: "WU001",
      packetId: "PKT-001",
      summary: "Checkpoint.",
      completed: [],
      notCompleted: [],
      filesChanged: [],
      issues: [],
      validationResult: "passed",
      acceptanceCriteriaResult: "passed",
      validationCommands: [],
      acceptanceCriteria: [],
      finalWorkUnitStatus: "done",
      nextRecommendation: "aiqt review",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("continues to accept legacy terminal checkpoints without a disposition", () => {
    expect(CheckpointSchema.safeParse(storedCheckpoint()).success).toBe(true);
  });

  it("accepts a progress checkpoint only with a null final status", () => {
    expect(CheckpointSchema.safeParse(storedCheckpoint({
      disposition: "progress",
      finalWorkUnitStatus: null,
      nextRecommendation: "aiqt continue",
    })).success).toBe(true);
  });

  it("rejects a manually edited in_progress final status", () => {
    expect(CheckpointSchema.safeParse(storedCheckpoint({ finalWorkUnitStatus: "in_progress" })).success).toBe(false);
  });
});
