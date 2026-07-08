import { describe, it, expect } from "vitest";
import { UpdateInputSchema } from "../../src/schema/update-input.schema.js";

describe("UpdateInputSchema", () => {
  it("validates a minimal valid patch", () => {
    const patch = {
      project: {
        objective: "Build a local CLI workflow engine.",
        targetUsers: ["Human project owner"],
      },
    };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(true);
  });

  it("validates a full patch with all record types", () => {
    const patch = {
      project: { objective: "X", targetUsers: ["dev"] },
      context: { constraints: ["local only"] },
      requirements: [{ title: "T", description: "D" }],
      decisions: [{ decision: "Use TS" }],
      assumptions: [{ statement: "assume this" }],
      risks: [{ title: "R", description: "D" }],
      openQuestions: [{ question: "Q?" }],
      quality: { preferredValidationCommands: ["pnpm test"] },
    };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(true);
  });

  it("rejects invalid enum values", () => {
    const patch = { requirements: [{ title: "T", description: "D", priority: "urgent" }] };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(false);
  });

  it("rejects unknown nested keys in project", () => {
    const patch = { project: { objective: "X", extra: "nope" } };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(false);
  });

  it("rejects unknown nested keys in a requirement record", () => {
    const patch = { requirements: [{ title: "T", description: "D", bogus: true }] };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const patch = { notAField: true };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(false);
  });

  it("accepts null for nullable fields like preferredAgent", () => {
    const patch = { project: { preferredAgent: null } };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(true);
  });

  it("rejects empty strings via min(1) where applicable", () => {
    const patch = { project: { objective: "" } };
    expect(UpdateInputSchema.safeParse(patch).success).toBe(false);
  });
});
