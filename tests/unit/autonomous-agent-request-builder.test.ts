import { describe, it, expect } from "vitest";
import { buildAutonomousAgentRequest, computeAgentRequestDigest } from "../../src/workflow/autonomous-agent-request-builder.js";
import { AUTONOMOUS_AGENT_PROVIDER_ID, AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS } from "../../src/schema/autonomous-agent-request.schema.js";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";

/**
 * M37-WU02 (build spec: "bounded prompt/context"; "minimal environment
 * projection"; "wall-clock and command budgets"). Pure unit tests -- no
 * I/O.
 */
function candidate(): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "manual",
    repository: "/some/repo",
    baseRef: "HEAD",
    objective: "fix a typo",
    acceptanceCriteria: ["typo fixed"],
    constraints: ["no new dependencies"],
    requestedPermissions: [],
  };
}

const budgets: AutonomousBudgets = { maxWallClockSeconds: 60, maxCommandCount: 5, maxRetryCount: 1, maxChangedFiles: 5, maxDiffLines: 100, maxValidationSeconds: 60 };

const policy: AutonomousExecutionPolicy = {
  allowedCommandClasses: ["read_only_inspection", "git_operation"],
  blockedCommandClasses: ["destructive", "privileged"],
  networkPolicy: "denied",
  filesystemBoundary: "/tmp/wt",
  gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
};

describe("buildAutonomousAgentRequest (M37-WU02, pure)", () => {
  it("uses the one fixed provider id", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy });
    expect(request.providerId).toBe(AUTONOMOUS_AGENT_PROVIDER_ID);
  });

  it("starts in status:pending", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy });
    expect(request.status).toBe("pending");
  });

  it("the prompt package carries the candidate's objective/acceptanceCriteria/constraints verbatim, plus non-empty instructions", () => {
    const c = candidate();
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: c, budgets, policy });
    expect(request.promptPackage.objective).toBe(c.objective);
    expect(request.promptPackage.acceptanceCriteria).toEqual(c.acceptanceCriteria);
    expect(request.promptPackage.constraints).toEqual(c.constraints);
    expect(request.promptPackage.instructions.length).toBeGreaterThan(0);
    expect(request.promptPackage.instructions).toMatch(/do not merge, push, or deploy/i);
  });

  it("environment projection defaults to empty when not supplied", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy });
    expect(request.environmentProjection).toEqual([]);
  });

  it("environment projection is exactly the caller-supplied name list, never more", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, environmentProjection: ["PATH"] });
    expect(request.environmentProjection).toEqual(["PATH"]);
  });

  it("expiresAt is exactly AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS after createdAt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, now });
    expect(request.createdAt).toBe(now.toISOString());
    expect(new Date(request.expiresAt).getTime() - now.getTime()).toBe(AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS * 1000);
  });

  it("requestDigest is a well-formed sha256 digest and is deterministic for identical input", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const a = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, now });
    const b = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, now });
    expect(a.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(a.requestDigest).toBe(b.requestDigest);
  });

  it("requestDigest changes when the candidate's objective changes", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const a = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, now });
    const b = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: { ...candidate(), objective: "a different fix" }, budgets, policy, now });
    expect(a.requestDigest).not.toBe(b.requestDigest);
  });

  it("allowedCommandClasses mirrors the supplied policy's own allowedCommandClasses", () => {
    const request = buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy });
    expect(request.allowedCommandClasses).toEqual(policy.allowedCommandClasses);
  });
});

describe("computeAgentRequestDigest (M37-WU02, pure)", () => {
  it("is order-independent: key order does not change the digest", () => {
    const promptPackage = { objective: "x", acceptanceCriteria: ["y"], constraints: [], instructions: "z" };
    const a = computeAgentRequestDigest({ runId: "run-1", candidate: candidate(), promptPackage, budgets });
    const b = computeAgentRequestDigest({ promptPackage, budgets, candidate: candidate(), runId: "run-1" });
    expect(a).toBe(b);
  });
});
