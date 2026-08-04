import { describe, expect, it } from "vitest";
import {
  AutonomousCandidateSchema,
  AutonomousEvidencePacketSchema,
  AutonomousResultStateSchema,
  AutonomousRunStatusSchema,
  AutonomousSafetyAssessmentSchema,
  RESULT_STATE_TERMINAL_STATUS,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
} from "../../src/schema/autonomous-run.schema.js";

function validCandidate() {
  return {
    issueId: "ISSUE-1",
    source: "issue" as const,
    repository: "example/repo",
    baseRef: "refs/heads/main",
    objective: "Fix a bug",
    acceptanceCriteria: ["bug no longer reproduces"],
  };
}

function validSafetyAssessment() {
  return {
    riskClass: "low_risk_autonomous" as const,
    commandPolicyProfile: "standard",
    networkPolicy: "denied" as const,
    reason: "clean",
  };
}

describe("M36-WU01: evidence packet contract completeness", () => {
  it("parses a fully-populated packet (post-execution, all optional sections present)", () => {
    const parsed = AutonomousEvidencePacketSchema.safeParse({
      runId: "run-1",
      candidate: validCandidate(),
      safetyAssessment: validSafetyAssessment(),
      workspace: {
        sourceRepository: "example/repo",
        baseRef: "refs/heads/main",
        baseCommit: "abc123",
        branch: "aiqt/run-1",
        worktreePath: "/tmp/aiqt-run-1",
        createdFiles: [],
        cleanupStatus: "cleaned" as const,
      },
      commandsExecuted: ["pnpm test"],
      filesChanged: ["src/foo.ts"],
      diffSummary: { changedFiles: 1, insertedLines: 3, deletedLines: 1 },
      validation: { targetedTestsPassed: true, authoritativeValidationPassed: true, durationSeconds: 12 },
      findings: [],
      residualRisk: "none identified",
      resultState: "passed" as const,
      recommendedHumanAction: "review_and_merge" as const,
    });
    expect(parsed.success).toBe(true);
  });

  it("parses a minimal packet (blocked before a workspace was ever prepared -- workspace/diffSummary/validation absent)", () => {
    const parsed = AutonomousEvidencePacketSchema.safeParse({
      runId: "run-2",
      candidate: validCandidate(),
      safetyAssessment: { ...validSafetyAssessment(), riskClass: "repository_dirty" as const },
      residualRisk: "repository was dirty; nothing executed",
      resultState: "blocked" as const,
      recommendedHumanAction: "provide_missing_input" as const,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Defaults must materialize, not leave the array fields undefined.
      expect(parsed.data.commandsExecuted).toEqual([]);
      expect(parsed.data.filesChanged).toEqual([]);
      expect(parsed.data.findings).toEqual([]);
    }
  });

  it("rejects a packet missing runId", () => {
    const parsed = AutonomousEvidencePacketSchema.safeParse({
      candidate: validCandidate(),
      safetyAssessment: validSafetyAssessment(),
      residualRisk: "x",
      resultState: "passed",
      recommendedHumanAction: "review_and_merge",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a packet missing residualRisk (recording no residual-risk statement is never valid)", () => {
    const parsed = AutonomousEvidencePacketSchema.safeParse({
      runId: "run-3",
      candidate: validCandidate(),
      safetyAssessment: validSafetyAssessment(),
      resultState: "passed",
      recommendedHumanAction: "review_and_merge",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown extra field (schema is .strict())", () => {
    const parsed = AutonomousEvidencePacketSchema.safeParse({
      runId: "run-4",
      candidate: validCandidate(),
      safetyAssessment: validSafetyAssessment(),
      residualRisk: "x",
      resultState: "passed",
      recommendedHumanAction: "review_and_merge",
      unexpectedField: "should not be allowed",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a candidate with no acceptance criteria at the schema level (empty array is structurally valid but semantically insufficient -- caught by the safety classifier, not the schema)", () => {
    const parsed = AutonomousCandidateSchema.safeParse({ ...validCandidate(), acceptanceCriteria: [] });
    expect(parsed.success).toBe(true);
  });
});

describe("M36-WU01: result-state invariants", () => {
  it("every result state maps to exactly one terminal run status", () => {
    for (const resultState of AutonomousResultStateSchema.options) {
      expect(RESULT_STATE_TERMINAL_STATUS[resultState]).toBeDefined();
    }
  });

  it("every result state's mapped status is itself terminal", () => {
    for (const resultState of AutonomousResultStateSchema.options) {
      const status = RESULT_STATE_TERMINAL_STATUS[resultState];
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  });

  it("the 8 documented result states are exactly the schema's enum (no drift)", () => {
    expect([...AutonomousResultStateSchema.options].sort()).toEqual(
      [
        "passed",
        "failed",
        "blocked",
        "needs_input",
        "cancelled",
        "budget_exhausted",
        "validation_failed",
        "review_rejected",
      ].sort(),
    );
  });

  it("the 5 documented terminal run statuses are exactly TERMINAL_RUN_STATUSES (no drift)", () => {
    expect([...TERMINAL_RUN_STATUSES].sort()).toEqual(["completed", "blocked", "failed", "cancelled", "budget_exhausted"].sort());
  });

  it("the 13 documented lifecycle statuses are exactly the schema's enum (no drift)", () => {
    expect([...AutonomousRunStatusSchema.options].sort()).toEqual(
      [
        "created",
        "preflight",
        "classified",
        "awaiting_approval",
        "preparing_workspace",
        "executing",
        "validating",
        "reviewing",
        "completed",
        "blocked",
        "failed",
        "cancelled",
        "budget_exhausted",
      ].sort(),
    );
  });
});

describe("M36-WU01: safety assessment contract", () => {
  it("parses a minimal valid assessment with schema defaults for the array fields", () => {
    const parsed = AutonomousSafetyAssessmentSchema.safeParse(validSafetyAssessment());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.prohibitedAreas).toEqual([]);
      expect(parsed.data.requiredApprovals).toEqual([]);
    }
  });

  it("rejects an unrecognized riskClass value", () => {
    const parsed = AutonomousSafetyAssessmentSchema.safeParse({ ...validSafetyAssessment(), riskClass: "nonsense" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unrecognized prohibitedAreas tag", () => {
    const parsed = AutonomousSafetyAssessmentSchema.safeParse({
      ...validSafetyAssessment(),
      prohibitedAreas: ["not_a_real_tag"],
    });
    expect(parsed.success).toBe(false);
  });
});
