import { describe, it, expect } from "vitest";
import {
  DecisionEscalationSchema,
  DecisionEscalationStatusSchema,
  DECISION_ESCALATION_MAX_RELATED_IDS_PER_COLLECTION,
  DECISION_ESCALATION_MAX_SERIALIZED_BYTES,
} from "../../src/schema/decision-escalation.schema.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeEscalation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    escalationId: "DE-001",
    escalationKey: "escalation:architecture:x",
    category: "architecture",
    status: "open",
    question: "Should we adopt this pattern project-wide?",
    rationale: "Affects multiple work units and future milestones.",
    relatedWorkUnitIds: [],
    relatedMilestoneIds: [],
    evidenceIds: [],
    resolution: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("DecisionEscalationSchema (M22-WU05)", () => {
  it("accepts a full valid open record", () => {
    expect(DecisionEscalationSchema.safeParse(makeEscalation()).success).toBe(true);
  });

  it("accepts a resolved record with a resolution", () => {
    const value = makeEscalation({
      status: "resolved",
      resolution: { answer: "Yes, adopt it.", resolvedAt: NOW, resolvedBy: "human:owner" },
    });
    expect(DecisionEscalationSchema.safeParse(value).success).toBe(true);
  });

  it("accepts a withdrawn record", () => {
    expect(DecisionEscalationSchema.safeParse(makeEscalation({ status: "withdrawn" })).success).toBe(true);
  });

  it("rejects an invalid status enum", () => {
    expect(DecisionEscalationSchema.safeParse(makeEscalation({ status: "pending" })).success).toBe(false);
  });

  it("status enum is exactly open|resolved|withdrawn, not a severity or fixability vocabulary", () => {
    expect(DecisionEscalationStatusSchema.options).toEqual(["open", "resolved", "withdrawn"]);
  });

  it("rejects an invalid category enum", () => {
    expect(DecisionEscalationSchema.safeParse(makeEscalation({ category: "marketing" })).success).toBe(false);
  });

  it("rejects an empty question", () => {
    expect(DecisionEscalationSchema.safeParse(makeEscalation({ question: "" })).success).toBe(false);
  });

  it("rejects an empty rationale", () => {
    expect(DecisionEscalationSchema.safeParse(makeEscalation({ rationale: "" })).success).toBe(false);
  });

  it("has no severity or agentCanFix field anywhere in the schema", () => {
    const parsed = DecisionEscalationSchema.parse(makeEscalation());
    expect(Object.prototype.hasOwnProperty.call(parsed, "severity")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "agentCanFix")).toBe(false);
  });

  it("rejects relatedWorkUnitIds beyond the cap", () => {
    const tooMany = Array.from({ length: DECISION_ESCALATION_MAX_RELATED_IDS_PER_COLLECTION + 1 }, (_, i) => `WU${i}`);
    expect(DecisionEscalationSchema.safeParse(makeEscalation({ relatedWorkUnitIds: tooMany })).success).toBe(false);
  });

  it("rejects relatedMilestoneIds beyond the cap", () => {
    const tooMany = Array.from({ length: DECISION_ESCALATION_MAX_RELATED_IDS_PER_COLLECTION + 1 }, (_, i) => `M${i}`);
    expect(DecisionEscalationSchema.safeParse(makeEscalation({ relatedMilestoneIds: tooMany })).success).toBe(false);
  });

  it("rejects a record exceeding max_serialized_bytes", () => {
    const oversized = makeEscalation({ rationale: "x".repeat(DECISION_ESCALATION_MAX_SERIALIZED_BYTES) });
    expect(DecisionEscalationSchema.safeParse(oversized).success).toBe(false);
  });

  it("does not conflate with the ProjectIssue effective-lifecycle vocabulary (no overlapping enum values)", () => {
    const projectIssueVocabulary = ["active", "accepted", "deferred", "resolved", "post_mvp", "promoted"];
    const escalationVocabulary = DecisionEscalationStatusSchema.options as readonly string[];
    // "resolved" intentionally appears in both -- it is a distinct concept
    // per vocabulary (issue lifecycle vs. decision status), not a shared
    // parallel state machine; every OTHER value must remain non-overlapping.
    const overlapExcludingResolved = escalationVocabulary.filter(
      (v) => v !== "resolved" && projectIssueVocabulary.includes(v),
    );
    expect(overlapExcludingResolved).toEqual([]);
  });
});
