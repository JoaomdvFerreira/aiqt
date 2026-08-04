import { describe, it, expect } from "vitest";
import { isValidAgentRequestTransition, isTerminalAgentRequestStatus, isAgentRequestExpired, cancelAgentRequest } from "../../src/workflow/autonomous-agent-request-lifecycle.js";
import { buildAutonomousAgentRequest } from "../../src/workflow/autonomous-agent-request-builder.js";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";

/**
 * M37-WU02 (build spec: "cancellation," reinterpreted as request-lifecycle
 * cancellation -- see docs/engineering/m37-wu02-agent-adapter-design-note.md).
 * Pure unit tests -- no I/O.
 */
function candidate(): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "manual",
    repository: "/some/repo",
    baseRef: "HEAD",
    objective: "fix a typo",
    acceptanceCriteria: ["typo fixed"],
    constraints: [],
    requestedPermissions: [],
  };
}
const budgets: AutonomousBudgets = { maxWallClockSeconds: 60, maxCommandCount: 5, maxRetryCount: 1, maxChangedFiles: 5, maxDiffLines: 100, maxValidationSeconds: 60 };
const policy: AutonomousExecutionPolicy = {
  allowedCommandClasses: ["read_only_inspection"],
  blockedCommandClasses: ["destructive", "privileged"],
  networkPolicy: "denied",
  filesystemBoundary: "/tmp/wt",
  gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
};

describe("isValidAgentRequestTransition / isTerminalAgentRequestStatus (M37-WU02, pure)", () => {
  it("pending can transition to imported, expired, or cancelled", () => {
    expect(isValidAgentRequestTransition("pending", "imported")).toBe(true);
    expect(isValidAgentRequestTransition("pending", "expired")).toBe(true);
    expect(isValidAgentRequestTransition("pending", "cancelled")).toBe(true);
  });

  it("no terminal status can transition anywhere, including to itself", () => {
    for (const status of ["imported", "expired", "cancelled"] as const) {
      expect(isValidAgentRequestTransition(status, "imported")).toBe(false);
      expect(isValidAgentRequestTransition(status, "expired")).toBe(false);
      expect(isValidAgentRequestTransition(status, "cancelled")).toBe(false);
      expect(isValidAgentRequestTransition(status, status)).toBe(false);
    }
  });

  it("pending is the only non-terminal status", () => {
    expect(isTerminalAgentRequestStatus("pending")).toBe(false);
    expect(isTerminalAgentRequestStatus("imported")).toBe(true);
    expect(isTerminalAgentRequestStatus("expired")).toBe(true);
    expect(isTerminalAgentRequestStatus("cancelled")).toBe(true);
  });
});

describe("isAgentRequestExpired (M37-WU02, pure)", () => {
  it("is false before expiresAt", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, now: new Date("2026-01-01T00:00:00.000Z") });
    expect(isAgentRequestExpired(request, new Date("2026-01-01T00:00:01.000Z"))).toBe(false);
  });

  it("is true exactly at and after expiresAt", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, now: new Date("2026-01-01T00:00:00.000Z") });
    expect(isAgentRequestExpired(request, new Date(request.expiresAt))).toBe(true);
    expect(isAgentRequestExpired(request, new Date(new Date(request.expiresAt).getTime() + 1000))).toBe(true);
  });
});

describe("cancelAgentRequest (M37-WU02, pure)", () => {
  it("cancels a pending request, recording cancelledAt", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy });
    const now = new Date("2026-01-02T00:00:00.000Z");
    const result = cancelAgentRequest(request, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.status).toBe("cancelled");
      expect(result.request.cancelledAt).toBe(now.toISOString());
    }
  });

  it("refuses to cancel an already-terminal request", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy });
    const first = cancelAgentRequest(request);
    if (!first.ok) throw new Error("first cancel unexpectedly failed");
    const second = cancelAgentRequest(first.request);
    expect(second.ok).toBe(false);
  });
});
