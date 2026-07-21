import { describe, it, expect } from "vitest";
import {
  decideFindingRoute,
  resolveFindingRoute,
  applyCheckpointToProjectIssueTransition,
  type RoutingSignals,
  type ProjectIssueSeedFields,
} from "../../src/workflow/finding-routing.js";
import type { ProjectIssue, ProjectIssueTransition } from "../../src/schema/project-issue.schema.js";

const NOW = "2026-01-01T00:00:00.000Z";

function executionLocalSignals(overrides: Partial<RoutingSignals> = {}): RoutingSignals {
  return {
    hasValidCheckpoint: true,
    scopeClaim: "execution_local",
    spansMultipleCheckpoints: false,
    spansMultipleWorkUnitsOrMilestones: false,
    remediableWithinExecution: true,
    ...overrides,
  };
}

describe("decideFindingRoute (M22-WU07 / F-06, spec §6.2/§6.3)", () => {
  it("routes to checkpoint_issue when every §6.2 condition holds", () => {
    expect(decideFindingRoute(executionLocalSignals())).toBe("checkpoint_issue");
  });

  it("routes to project_issue when no valid checkpoint exists", () => {
    expect(decideFindingRoute(executionLocalSignals({ hasValidCheckpoint: false }))).toBe("project_issue");
  });

  it("routes to project_issue when the finding spans multiple checkpoints", () => {
    expect(decideFindingRoute(executionLocalSignals({ spansMultipleCheckpoints: true }))).toBe("project_issue");
  });

  it("routes to project_issue when the finding spans multiple work units or milestones", () => {
    expect(decideFindingRoute(executionLocalSignals({ spansMultipleWorkUnitsOrMilestones: true }))).toBe("project_issue");
  });

  it.each([
    "cross_work_unit",
    "milestone",
    "project",
    "release",
    "architecture",
    "security",
    "legal_compliance",
    "governance",
    "external_setup",
  ] as const)("routes to project_issue for the %s scope claim", (scopeClaim) => {
    expect(decideFindingRoute(executionLocalSignals({ scopeClaim }))).toBe("project_issue");
  });

  it("routes to project_issue when remediation is not possible within the same execution", () => {
    expect(decideFindingRoute(executionLocalSignals({ remediableWithinExecution: false }))).toBe("project_issue");
  });

  it("routes to checkpoint_issue for the work_unit scope claim when every other condition holds", () => {
    expect(decideFindingRoute(executionLocalSignals({ scopeClaim: "work_unit" }))).toBe("checkpoint_issue");
  });

  it("never produces a third outcome", () => {
    const result = decideFindingRoute(executionLocalSignals());
    expect(["checkpoint_issue", "project_issue"]).toContain(result);
  });
});

describe("resolveFindingRoute (M22-WU07 / no-dual-creation, spec §6.4)", () => {
  it("links to an existing ProjectIssue when the key already owns one, even if signals would suggest checkpoint_issue", () => {
    const result = resolveFindingRoute(executionLocalSignals(), "k-1", new Set(["k-1"]), new Set());
    expect(result).toEqual({ route: "project_issue", issueKey: "k-1", isNewRecord: false });
  });

  it("links to an existing CheckpointIssue when the key already owns one", () => {
    const result = resolveFindingRoute(executionLocalSignals(), "k-2", new Set(), new Set(["k-2"]));
    expect(result).toEqual({ route: "checkpoint_issue", issueKey: "k-2", isNewRecord: false });
  });

  it("ProjectIssue ownership takes precedence if a key were (incorrectly) present in both sets", () => {
    const result = resolveFindingRoute(executionLocalSignals(), "k-3", new Set(["k-3"]), new Set(["k-3"]));
    expect(result.route).toBe("project_issue");
    expect(result.isNewRecord).toBe(false);
  });

  it("applies the route decision fresh when no existing record owns the key", () => {
    const result = resolveFindingRoute(executionLocalSignals({ scopeClaim: "security" }), "k-4", new Set(), new Set());
    expect(result).toEqual({ route: "project_issue", issueKey: "k-4", isNewRecord: true });
  });

  it("a repeated call with the same key and now-known existing records always links, never creates twice", () => {
    const first = resolveFindingRoute(executionLocalSignals({ scopeClaim: "security" }), "k-5", new Set(), new Set());
    expect(first.isNewRecord).toBe(true);
    const second = resolveFindingRoute(executionLocalSignals({ scopeClaim: "security" }), "k-5", new Set(["k-5"]), new Set());
    expect(second.isNewRecord).toBe(false);
  });
});

describe("applyCheckpointToProjectIssueTransition (M22-WU07 / spec §5.6/§6.4)", () => {
  const seed: ProjectIssueSeedFields = {
    title: "Architecture concern",
    description: "Spans multiple work units",
    severity: "high",
    sourceType: "checkpoint",
    sourceRefs: [],
    affectedWorkUnitIds: ["WU001"],
    affectedMilestoneIds: [],
    evidenceIds: [],
    checkpointRefs: ["C001"],
    ownerRef: null,
    promotionRefs: [],
  };

  function baseParams(overrides: Partial<Parameters<typeof applyCheckpointToProjectIssueTransition>[0]> = {}) {
    return {
      issueKey: "checkpoint:WU001:issue:x",
      checkpointId: "C001",
      checkpointIssueRef: "checkpoint:WU001:issue:x",
      reason: "scope_expanded" as const,
      evidenceIds: [],
      existingProjectIssues: [] as ProjectIssue[],
      existingTransitions: [] as ProjectIssueTransition[],
      timestamp: NOW,
      nextProjectIssueId: "PI-001",
      nextTransitionId: "PIT-001",
      projectIssueSeedFields: seed,
      ...overrides,
    };
  }

  it("creates one new ProjectIssue and one new transition on first application", () => {
    const result = applyCheckpointToProjectIssueTransition(baseParams());
    expect(result.changed).toBe(true);
    expect(result.transition).not.toBeNull();
    expect(result.projectIssue.projectIssueId).toBe("PI-001");
    expect(result.projectIssue.issueKey).toBe("checkpoint:WU001:issue:x");
    expect(result.transition?.issueKey).toBe("checkpoint:WU001:issue:x");
    expect(result.transition?.from).toEqual({
      lifecycle: "checkpoint_issue",
      checkpointId: "C001",
      checkpointIssueRef: "checkpoint:WU001:issue:x",
    });
    expect(result.transition?.to).toEqual({ lifecycle: "project_issue", projectIssueId: "PI-001" });
  });

  it("preserves the canonical issueKey unchanged on both the ProjectIssue and the transition", () => {
    const result = applyCheckpointToProjectIssueTransition(baseParams());
    expect(result.projectIssue.issueKey).toBe(result.transition?.issueKey);
  });

  it("is idempotent: replaying the same transition request returns changed: false and no second transition", () => {
    const existing: ProjectIssueTransition = {
      transitionId: "PIT-001",
      issueKey: "checkpoint:WU001:issue:x",
      from: { lifecycle: "checkpoint_issue", checkpointId: "C001", checkpointIssueRef: "checkpoint:WU001:issue:x" },
      to: { lifecycle: "project_issue", projectIssueId: "PI-001" },
      reason: "scope_expanded",
      evidenceIds: [],
      createdAt: NOW,
    };
    const existingProjectIssue: ProjectIssue = {
      projectIssueId: "PI-001",
      issueKey: "checkpoint:WU001:issue:x",
      ...seed,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const result = applyCheckpointToProjectIssueTransition(
      baseParams({ existingTransitions: [existing], existingProjectIssues: [existingProjectIssue] }),
    );
    expect(result.changed).toBe(false);
    expect(result.transition).toBeNull();
    expect(result.projectIssue.projectIssueId).toBe("PI-001");
  });

  it("links to an existing ProjectIssue by issueKey instead of minting a new projectIssueId when one already exists but no transition yet", () => {
    const existingProjectIssue: ProjectIssue = {
      projectIssueId: "PI-777",
      issueKey: "checkpoint:WU001:issue:x",
      ...seed,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const result = applyCheckpointToProjectIssueTransition(
      baseParams({ existingProjectIssues: [existingProjectIssue] }),
    );
    expect(result.changed).toBe(true);
    expect(result.projectIssue.projectIssueId).toBe("PI-777");
    expect(result.transition?.to.projectIssueId).toBe("PI-777");
  });

  it("does not mutate or reference any original CheckpointIssue record -- only a checkpointId/ref string is required", () => {
    const result = applyCheckpointToProjectIssueTransition(baseParams());
    expect(result.transition?.from.checkpointId).toBe("C001");
    expect(result.transition?.from.checkpointIssueRef).toBe("checkpoint:WU001:issue:x");
  });
});
