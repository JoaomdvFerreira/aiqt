import { describe, it, expect } from "vitest";
import { buildAutonomousPrDraft } from "../../src/workflow/autonomous-run-pr-draft.js";
import type { AutonomousCandidate, AutonomousEvidencePacket, AutonomousSafetyAssessment } from "../../src/schema/autonomous-run.schema.js";

/**
 * M37-WU04 (build spec: "PR draft text"). Pure unit tests -- no I/O, no
 * network, no real PR is ever created.
 */
function candidate(): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "manual",
    repository: "/some/repo",
    baseRef: "HEAD",
    objective: "fix a typo in the README",
    acceptanceCriteria: ["typo fixed", "no other files changed"],
    constraints: [],
    requestedPermissions: [],
  };
}

function safetyAssessment(): AutonomousSafetyAssessment {
  return {
    riskClass: "low_risk_autonomous",
    prohibitedAreas: [],
    requiredApprovals: [],
    commandPolicyProfile: "standard",
    networkPolicy: "denied",
    reason: "clean",
  };
}

function packet(overrides: Partial<AutonomousEvidencePacket> = {}): AutonomousEvidencePacket {
  return {
    runId: "run-1",
    candidate: candidate(),
    safetyAssessment: safetyAssessment(),
    commandsExecuted: ["git mv README.md README2.md"],
    filesChanged: ["README2.md"],
    diffSummary: { changedFiles: 1, insertedLines: 0, deletedLines: 0, unexpectedFiles: [] },
    validation: { targetedTestsPassed: true, authoritativeValidationPassed: null, durationSeconds: 0.5 },
    findings: [],
    residualRisk: "Validation passed and no self-review findings were raised.",
    resultState: "passed",
    recommendedHumanAction: "review_and_merge",
    ...overrides,
  };
}

describe("buildAutonomousPrDraft (M37-WU04, pure)", () => {
  it("title includes the candidate's objective and is bounded", () => {
    const draft = buildAutonomousPrDraft(candidate(), packet());
    expect(draft.title).toContain("fix a typo in the README");
    expect(draft.title.length).toBeLessThanOrEqual(100);
  });

  it("body includes issue id, objective, acceptance criteria, and diff/validation summary", () => {
    const draft = buildAutonomousPrDraft(candidate(), packet());
    expect(draft.body).toContain("ISSUE-1");
    expect(draft.body).toContain("fix a typo in the README");
    expect(draft.body).toContain("typo fixed");
    expect(draft.body).toContain("1 file(s) changed");
    expect(draft.body).toContain("Targeted validation: passed");
  });

  it("body includes self-review findings when present", () => {
    const draft = buildAutonomousPrDraft(candidate(), packet({ findings: ["Diff size (600 lines) exceeds the run's budget (500)."] }));
    expect(draft.body).toContain("Diff size (600 lines) exceeds the run's budget (500).");
  });

  it("body always states the run never merges/pushes/deploys automatically", () => {
    const draft = buildAutonomousPrDraft(candidate(), packet());
    expect(draft.body).toMatch(/nothing has been merged, pushed, or deployed/i);
  });

  it("never contains a real PR-creation call -- this is text generation only (structural sanity: no fetch/network-shaped identifiers anywhere in the output)", () => {
    const draft = buildAutonomousPrDraft(candidate(), packet());
    expect(draft.title + draft.body).not.toMatch(/https?:\/\//);
  });
});
