import { describe, it, expect } from "vitest";
import {
  ProjectIssueSchema,
  ProjectIssueTransitionSchema,
  PROJECT_ISSUE_MAX_SERIALIZED_BYTES,
  PROJECT_ISSUE_MAX_SOURCE_REFS,
} from "../../src/schema/project-issue.schema.js";
import { resolveEffectiveProjectIssueLifecycle } from "../../src/services/project-issue-service.js";
import type { IssueOverride, IssuePromotion } from "../../src/schema/issue-state.schema.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeProjectIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    projectIssueId: "PI-001",
    issueKey: "checkpoint:WU001:issue:x",
    title: "Architecture concern",
    description: "Spans multiple work units",
    severity: "high",
    sourceType: "checkpoint",
    sourceRefs: [],
    affectedWorkUnitIds: ["WU001", "WU002"],
    affectedMilestoneIds: [],
    evidenceIds: [],
    checkpointRefs: [],
    ownerRef: null,
    promotionRefs: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("ProjectIssueSchema (M22-WU03)", () => {
  it("accepts a full valid record", () => {
    expect(ProjectIssueSchema.safeParse(makeProjectIssue()).success).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ title: "" })).success).toBe(false);
  });

  it("rejects an empty description", () => {
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ description: "" })).success).toBe(false);
  });

  it("rejects an invalid severity enum", () => {
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ severity: "urgent" })).success).toBe(false);
  });

  it("rejects an invalid sourceType enum", () => {
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ sourceType: "bot" })).success).toBe(false);
  });

  it("rejects an invalid timestamp shape (non-string)", () => {
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ createdAt: 12345 })).success).toBe(false);
  });

  it("accepts a null ownerRef and rejects a missing one", () => {
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ ownerRef: null })).success).toBe(true);
    const { ownerRef, ...withoutOwnerRef } = makeProjectIssue();
    void ownerRef;
    expect(ProjectIssueSchema.safeParse(withoutOwnerRef).success).toBe(false);
  });

  it("does not persist any mutable lifecycle status/acknowledgment/deferment/resolution/post-mvp/promotion field", () => {
    const parsed = ProjectIssueSchema.parse(makeProjectIssue());
    for (const forbidden of ["status", "acknowledged", "deferred", "resolved", "postMvp", "promoted"]) {
      expect(Object.prototype.hasOwnProperty.call(parsed, forbidden)).toBe(false);
    }
  });

  it("rejects sourceRefs beyond the max-source-refs cap", () => {
    const tooMany = Array.from({ length: PROJECT_ISSUE_MAX_SOURCE_REFS + 1 }, (_, i) => `ref-${i}`);
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ sourceRefs: tooMany })).success).toBe(false);
  });

  it("accepts sourceRefs exactly at the cap", () => {
    const atCap = Array.from({ length: PROJECT_ISSUE_MAX_SOURCE_REFS }, (_, i) => `ref-${i}`);
    expect(ProjectIssueSchema.safeParse(makeProjectIssue({ sourceRefs: atCap })).success).toBe(true);
  });

  it("rejects a record exceeding max_serialized_bytes", () => {
    const oversized = makeProjectIssue({ description: "x".repeat(PROJECT_ISSUE_MAX_SERIALIZED_BYTES) });
    expect(ProjectIssueSchema.safeParse(oversized).success).toBe(false);
  });
});

describe("ProjectIssueTransitionSchema (M22-WU03)", () => {
  function makeTransition(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      transitionId: "PIT-001",
      issueKey: "checkpoint:WU001:issue:x",
      from: { lifecycle: "checkpoint_issue", checkpointId: "C001", checkpointIssueRef: "checkpoint:WU001:issue:x" },
      to: { lifecycle: "project_issue", projectIssueId: "PI-001" },
      reason: "scope_expanded",
      evidenceIds: [],
      createdAt: NOW,
      ...overrides,
    };
  }

  it("accepts a full valid record", () => {
    expect(ProjectIssueTransitionSchema.safeParse(makeTransition()).success).toBe(true);
  });

  it("rejects an invalid reason enum", () => {
    expect(ProjectIssueTransitionSchema.safeParse(makeTransition({ reason: "because" })).success).toBe(false);
  });

  it("rejects a from.lifecycle value other than the checkpoint_issue literal", () => {
    const bad = makeTransition({ from: { lifecycle: "project_issue", checkpointId: "C001", checkpointIssueRef: "x" } });
    expect(ProjectIssueTransitionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a to.lifecycle value other than the project_issue literal", () => {
    const bad = makeTransition({ to: { lifecycle: "checkpoint_issue", projectIssueId: "PI-001" } });
    expect(ProjectIssueTransitionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty checkpointId", () => {
    const bad = makeTransition({ from: { lifecycle: "checkpoint_issue", checkpointId: "", checkpointIssueRef: "x" } });
    expect(ProjectIssueTransitionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("resolveEffectiveProjectIssueLifecycle (M22-WU03 / spec §5.5.1)", () => {
  const overrides: IssueOverride[] = [
    { issueKey: "k-accepted", status: "accepted", reason: "r", updatedAt: NOW, sourceCommand: "aiqt issue update" },
    { issueKey: "k-deferred", status: "deferred", reason: "r", updatedAt: NOW, sourceCommand: "aiqt issue update" },
    { issueKey: "k-resolved", status: "resolved", reason: "r", updatedAt: NOW, sourceCommand: "aiqt issue update" },
    { issueKey: "k-post-mvp", status: "post_mvp", reason: "r", updatedAt: NOW, sourceCommand: "aiqt issue update" },
  ];
  const promotions: IssuePromotion[] = [
    { issueKey: "k-promoted", workUnitId: "WU010", milestoneId: "M010", promotedAt: NOW, sourceCommand: "aiqt issue promote" },
  ];

  it("defaults to active when no override or promotion applies", () => {
    expect(resolveEffectiveProjectIssueLifecycle("k-unknown", overrides, promotions)).toBe("active");
  });

  it.each(["accepted", "deferred", "resolved", "post_mvp"] as const)(
    "resolves the existing override status %s identically to the CheckpointIssue path",
    (status) => {
      expect(resolveEffectiveProjectIssueLifecycle(`k-${status.replace("_", "-")}`, overrides, promotions)).toBe(status);
    },
  );

  it("resolves to promoted when a promotion record exists, taking precedence over any override", () => {
    expect(resolveEffectiveProjectIssueLifecycle("k-promoted", overrides, promotions)).toBe("promoted");
  });

  it("promotion precedence holds even when the same key also has an override", () => {
    const mixedOverrides: IssueOverride[] = [
      { issueKey: "k-both", status: "deferred", reason: "r", updatedAt: NOW, sourceCommand: "aiqt issue update" },
    ];
    const mixedPromotions: IssuePromotion[] = [
      { issueKey: "k-both", workUnitId: "WU011", milestoneId: "M011", promotedAt: NOW, sourceCommand: "aiqt issue promote" },
    ];
    expect(resolveEffectiveProjectIssueLifecycle("k-both", mixedOverrides, mixedPromotions)).toBe("promoted");
  });

  it("introduces no open|acknowledged|resolved parallel vocabulary -- every possible result is one of the six authoritative values", () => {
    const authoritative = ["active", "accepted", "deferred", "resolved", "post_mvp", "promoted"];
    for (const key of ["k-unknown", "k-accepted", "k-deferred", "k-resolved", "k-post-mvp", "k-promoted"]) {
      expect(authoritative).toContain(resolveEffectiveProjectIssueLifecycle(key, overrides, promotions));
    }
  });
});
