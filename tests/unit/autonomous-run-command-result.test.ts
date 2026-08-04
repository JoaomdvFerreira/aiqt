import { describe, it, expect } from "vitest";
import { buildAutonomousRunCommandResult } from "../../src/services/autonomous-run-command-result.js";
import type { AutonomousCandidate, AutonomousEvidencePacket, AutonomousSafetyAssessment } from "../../src/schema/autonomous-run.schema.js";

/**
 * M36-WU04 (build spec acceptance criterion: "packet follows the M33
 * machine contract"). Pure unit tests -- no I/O, no subprocess.
 */
function candidate(): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "issue",
    repository: "example/repo",
    baseRef: "HEAD",
    objective: "Fix a failing test",
    acceptanceCriteria: ["tests pass"],
    constraints: [],
    requestedPermissions: [],
  };
}

function safetyAssessment(): AutonomousSafetyAssessment {
  return {
    riskClass: "low_risk_autonomous",
    prohibitedAreas: [],
    requiredApprovals: [],
    commandPolicyProfile: "default",
    networkPolicy: "denied",
    reason: "No prohibited areas detected.",
  };
}

function packet(overrides: Partial<AutonomousEvidencePacket> = {}): AutonomousEvidencePacket {
  return {
    runId: "run-1",
    candidate: candidate(),
    safetyAssessment: safetyAssessment(),
    commandsExecuted: [],
    filesChanged: [],
    findings: [],
    residualRisk: "none",
    resultState: "passed",
    recommendedHumanAction: "review_and_merge",
    ...overrides,
  };
}

describe("buildAutonomousRunCommandResult (M36-WU04, pure)", () => {
  it("maps a passed result state to status:passed, exitCode:0, and no requiresHumanInput", () => {
    const result = buildAutonomousRunCommandResult(packet());
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.requiresHumanInput).toBe(false);
    expect(result.action).toBe("autonomous");
    expect(result.data?.resultState).toBe("passed");
  });

  it("maps validation_failed and review_rejected to status:failed", () => {
    expect(buildAutonomousRunCommandResult(packet({ resultState: "validation_failed" })).status).toBe("failed");
    expect(buildAutonomousRunCommandResult(packet({ resultState: "review_rejected" })).status).toBe("failed");
  });

  it("maps blocked, cancelled, and budget_exhausted to status:blocked", () => {
    expect(buildAutonomousRunCommandResult(packet({ resultState: "blocked" })).status).toBe("blocked");
    expect(buildAutonomousRunCommandResult(packet({ resultState: "cancelled" })).status).toBe("blocked");
    expect(buildAutonomousRunCommandResult(packet({ resultState: "budget_exhausted" })).status).toBe("blocked");
  });

  it("maps needs_input to status:needs_input, exitCode:10, and requiresHumanInput:true (M33 Sec 5.2 invariant)", () => {
    const result = buildAutonomousRunCommandResult(packet({ resultState: "needs_input" }));
    expect(result.status).toBe("needs_input");
    expect(result.exitCode).toBe(10);
    expect(result.requiresHumanInput).toBe(true);
  });

  it("surfaces self-review findings as warnings, one Issue per finding", () => {
    const result = buildAutonomousRunCommandResult(
      packet({ findings: ["finding A", "finding B"], resultState: "review_rejected" }),
    );
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.map((w) => w.message)).toEqual(["finding A", "finding B"]);
  });

  it("carries commandsExecuted and filesChanged through to the CommandResult's own fields", () => {
    const result = buildAutonomousRunCommandResult(
      packet({ commandsExecuted: ["git status"], filesChanged: ["README.md"] }),
    );
    expect(result.completedActions).toEqual(["git status"]);
    expect(result.changedFiles).toEqual(["README.md"]);
  });

  it("embeds the full evidence packet in data without mutating it", () => {
    const p = packet();
    const result = buildAutonomousRunCommandResult(p);
    expect(result.data).toEqual(p);
  });
});
