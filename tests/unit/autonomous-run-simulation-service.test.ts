import { describe, it, expect } from "vitest";
import { simulateAutonomousRun } from "../../src/services/autonomous-run-simulation-service.js";
import type { AutonomousCandidate, AutonomousSafetyAssessment } from "../../src/schema/autonomous-run.schema.js";

/**
 * M37-WU01 (build spec: "simulation-only implementation"; "do not imply
 * that a real agent ran"). Pure unit tests -- no I/O, no subprocess.
 */
function candidate(): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "manual",
    repository: "example/repo",
    baseRef: "HEAD",
    objective: "fix something",
    acceptanceCriteria: ["it works"],
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
    reason: "No prohibited area detected.",
  };
}

describe("simulateAutonomousRun (M37-WU01, pure)", () => {
  it("always returns resultState:needs_input -- a simulation can never claim passed", () => {
    const packet = simulateAutonomousRun({ runId: "run-1", candidate: candidate(), safetyAssessment: safetyAssessment() });
    expect(packet.resultState).toBe("needs_input");
    expect(packet.recommendedHumanAction).toBe("provide_missing_input");
  });

  it("performs no commands and no file changes", () => {
    const packet = simulateAutonomousRun({ runId: "run-1", candidate: candidate(), safetyAssessment: safetyAssessment() });
    expect(packet.commandsExecuted).toEqual([]);
    expect(packet.filesChanged).toEqual([]);
    expect(packet.workspace).toBeUndefined();
    expect(packet.diffSummary).toBeUndefined();
    expect(packet.validation).toBeUndefined();
  });

  it("its findings explicitly state this is a simulation, not a real run", () => {
    const packet = simulateAutonomousRun({ runId: "run-1", candidate: candidate(), safetyAssessment: safetyAssessment() });
    expect(packet.findings.length).toBeGreaterThan(0);
    expect(packet.findings[0]).toMatch(/SIMULATED RUN/);
    expect(packet.findings[0]).toMatch(/no coding agent was invoked/i);
  });

  it("carries the exact runId, candidate, and safetyAssessment it was given", () => {
    const c = candidate();
    const sa = safetyAssessment();
    const packet = simulateAutonomousRun({ runId: "run-42", candidate: c, safetyAssessment: sa });
    expect(packet.runId).toBe("run-42");
    expect(packet.candidate).toEqual(c);
    expect(packet.safetyAssessment).toEqual(sa);
  });
});
