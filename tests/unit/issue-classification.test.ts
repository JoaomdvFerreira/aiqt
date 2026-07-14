import { describe, it, expect } from "vitest";
import { classifyCheckpointIssue } from "../../src/workflow/issue-classification.js";
import type { CheckpointIssue } from "../../src/schema/checkpoint.schema.js";

function issue(overrides: Partial<CheckpointIssue> = {}): CheckpointIssue {
  return {
    title: "Issue",
    description: null,
    severity: "medium",
    status: "open",
    agentCanFix: true,
    ...overrides,
  };
}

describe("classifyCheckpointIssue: agentCanFix precedence (M10 §8.2)", () => {
  it("never classifies an agentCanFix: false issue as agent-fixable, even with technical keywords", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Fix the RLS schema query code", agentCanFix: false }),
    );
    expect(result.agentFixable).toBe(false);
  });

  it("classifies an agentCanFix: true issue as agent-fixable when no stronger signal exists", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Refactor the query builder for clarity", agentCanFix: true }),
    );
    expect(result.agentFixable).toBe(true);
  });

  it("overrides agentCanFix: true when the text has an explicit user-action signal", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Requires user to configure Supabase dashboard credentials", agentCanFix: true }),
    );
    expect(result.agentFixable).toBe(false);
    expect(result.userActionRequired).toBe(true);
  });

  it("overrides agentCanFix: true when the text has an external-verification signal", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Needs live Sentry verification in production", agentCanFix: true }),
    );
    expect(result.agentFixable).toBe(false);
    expect(result.externalVerificationGap).toBe(true);
  });
});

describe("classifyCheckpointIssue: external verification gap detection", () => {
  const services = [
    "Supabase",
    "Clerk",
    "Storage",
    "Resend",
    "Sentry",
    "Vercel",
    "live smoke test",
  ];

  for (const service of services) {
    it(`detects an external verification gap mentioning "${service}"`, () => {
      const result = classifyCheckpointIssue(
        issue({ title: `Verify ${service} integration before release`, agentCanFix: false }),
      );
      expect(result.externalVerificationGap).toBe(true);
    });
  }
});

describe("classifyCheckpointIssue: user-action classifier excludes non-user-action wording (M10 §8.4)", () => {
  const nonUserActionCases: Array<{ label: string; title: string }> = [
    { label: "scope note", title: "Scope note: mobile layout deferred to a later unit" },
    { label: "implementation trade-off", title: "Trade-off: used in-memory cache instead of Redis" },
    { label: "fixed-dictionary i18n limitation", title: "Fixed-dictionary i18n limitation for date formats" },
    { label: "audit-scope note", title: "Audit-scope note: logging coverage limited to auth routes" },
    { label: "internal optimization note", title: "Internal optimization note: query could be batched later" },
  ];

  for (const { label, title } of nonUserActionCases) {
    it(`does not classify a ${label} as user-action-required even when agentCanFix is false`, () => {
      const result = classifyCheckpointIssue(issue({ title, agentCanFix: false }));
      expect(result.userActionRequired).toBe(false);
    });
  }

  it("still classifies as user-action-required when explicit user-action wording overrides an exclusion keyword", () => {
    const result = classifyCheckpointIssue(
      issue({
        title: "Scope note: user must manually configure the Supabase dashboard for this optimization",
        agentCanFix: false,
      }),
    );
    expect(result.userActionRequired).toBe(true);
  });

  it("classifies a plain agentCanFix: false issue with no keyword match as user-action-required by default", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Needs manual review before merge", agentCanFix: false }),
    );
    expect(result.userActionRequired).toBe(true);
  });

  it("classifies explicit user-action wording as user-action-required even when agentCanFix is true", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "User must set up branch protection rules", agentCanFix: true }),
    );
    expect(result.userActionRequired).toBe(true);
  });
});

describe("classifyCheckpointIssue: release-blocking and backlog classification", () => {
  it("classifies an open high-severity user-action issue as release-blocking", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Legal review required before launch", severity: "high", agentCanFix: false }),
    );
    expect(result.releaseBlocking).toBe(true);
  });

  it("classifies explicit release-critical wording as release-blocking regardless of severity", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Branch protection must be enabled", severity: "low", agentCanFix: false }),
    );
    expect(result.releaseBlocking).toBe(true);
  });

  it("does not classify a closed issue as release-blocking", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Legal review required", severity: "critical", status: "resolved", agentCanFix: false }),
    );
    expect(result.releaseBlocking).toBe(false);
  });

  it("captures low-severity non-blocking issues as backlog candidates", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Minor internal optimization note", severity: "low", agentCanFix: true }),
    );
    expect(result.backlogCandidate).toBe(true);
    expect(result.releaseBlocking).toBe(false);
  });

  it("captures medium-severity non-blocking issues as backlog candidates", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Consider batching queries later", severity: "medium", agentCanFix: true }),
    );
    expect(result.backlogCandidate).toBe(true);
  });

  it("does not classify a release-blocking issue as a backlog candidate", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Live Supabase verification required", severity: "medium", agentCanFix: false }),
    );
    expect(result.releaseBlocking).toBe(true);
    expect(result.backlogCandidate).toBe(false);
  });

  it("does not classify a closed low-severity issue as a backlog candidate", () => {
    const result = classifyCheckpointIssue(
      issue({ title: "Minor cleanup", severity: "low", status: "resolved" }),
    );
    expect(result.backlogCandidate).toBe(false);
  });
});
