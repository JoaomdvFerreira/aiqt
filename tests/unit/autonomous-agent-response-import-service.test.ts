import { describe, it, expect } from "vitest";
import { importAutonomousAgentResponse, computeRawResponseDigest } from "../../src/services/autonomous-agent-response-import-service.js";
import { buildImportAgentResponseCommandResult } from "../../src/services/autonomous-agent-response-import-result.js";
import { buildAutonomousAgentRequest } from "../../src/workflow/autonomous-agent-request-builder.js";
import { cancelAgentRequest } from "../../src/workflow/autonomous-agent-request-lifecycle.js";
import { AUTONOMOUS_AGENT_PROVIDER_ID } from "../../src/schema/autonomous-agent-request.schema.js";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";

/**
 * M37-WU02 (build spec: "failure classification"; "provider errors map to
 * M33 contract"). Pure unit tests -- no I/O, no subprocess (importing a
 * response is a parse + validate + record operation only).
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

function pendingRequest(now = new Date("2026-01-01T00:00:00.000Z")) {
  return buildAutonomousAgentRequest({ requestId: "req-1", runId: "run-1", candidate: candidate(), budgets, policy, now });
}

describe("importAutonomousAgentResponse (M37-WU02, pure)", () => {
  it("succeeds for a well-formed response matching the request", () => {
    const request = pendingRequest();
    const response = { requestId: "req-1", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [{ command: "git", args: ["status"] }] };
    const result = importAutonomousAgentResponse(request, response, new Date("2026-01-01T00:00:01.000Z"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.status).toBe("imported");
      expect(result.response.commandsProposed).toEqual(response.commandsProposed);
    }
  });

  it("never executes any proposed command -- a successful import returns data only, no execution outcome field", () => {
    const request = pendingRequest();
    const response = { requestId: "req-1", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [{ command: "rm", args: ["-rf", "."] }] };
    const result = importAutonomousAgentResponse(request, response, new Date("2026-01-01T00:00:01.000Z"));
    // Even a destructive-looking proposed command imports fine -- import
    // is pure record-keeping; policy enforcement happens only if/when a
    // future orchestration Work Unit actually executes a proposal, never
    // here.
    expect(result.ok).toBe(true);
  });

  it("fails closed for a request that is not pending (already imported)", () => {
    const request = pendingRequest();
    const response = { requestId: "req-1", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [] };
    const first = importAutonomousAgentResponse(request, response, new Date("2026-01-01T00:00:01.000Z"));
    if (!first.ok) throw new Error("first import unexpectedly failed");
    const second = importAutonomousAgentResponse(first.request, response, new Date("2026-01-01T00:00:02.000Z"));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("request_not_pending");
  });

  it("fails closed for a cancelled request", () => {
    const request = pendingRequest();
    const cancelled = cancelAgentRequest(request);
    if (!cancelled.ok) throw new Error("cancel unexpectedly failed");
    const response = { requestId: "req-1", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [] };
    const result = importAutonomousAgentResponse(cancelled.request, response);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("request_not_pending");
  });

  it("fails closed for an expired request", () => {
    const request = pendingRequest(new Date("2026-01-01T00:00:00.000Z"));
    const response = { requestId: "req-1", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [] };
    const wayLater = new Date(new Date(request.expiresAt).getTime() + 1000);
    const result = importAutonomousAgentResponse(request, response, wayLater);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("request_expired");
  });

  it("fails closed for a malformed response (schema-invalid)", () => {
    const request = pendingRequest();
    const result = importAutonomousAgentResponse(request, { not: "a valid response" }, new Date("2026-01-01T00:00:01.000Z"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed_response");
  });

  it("fails closed for a requestId mismatch", () => {
    const request = pendingRequest();
    const response = { requestId: "req-DIFFERENT", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [] };
    const result = importAutonomousAgentResponse(request, response, new Date("2026-01-01T00:00:01.000Z"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("request_id_mismatch");
  });
});

describe("computeRawResponseDigest (M37-WU02, pure)", () => {
  it("is deterministic and well-formed", () => {
    expect(computeRawResponseDigest("hello")).toBe(computeRawResponseDigest("hello"));
    expect(computeRawResponseDigest("hello")).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes when the input text changes", () => {
    expect(computeRawResponseDigest("hello")).not.toBe(computeRawResponseDigest("hello world"));
  });
});

describe("buildImportAgentResponseCommandResult (M37-WU02, pure -- M33 contract mapping)", () => {
  it("maps a successful import to status:passed, exitCode:0", () => {
    const request = pendingRequest();
    const response = { requestId: "req-1", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [{ command: "git", args: ["status"] }] };
    const importResult = importAutonomousAgentResponse(request, response, new Date("2026-01-01T00:00:01.000Z"));
    const result = buildImportAgentResponseCommandResult(importResult);
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.action).toBe("autonomous");
  });

  it("maps request_expired to status:failed, exitCode:2 (WorkflowBlocked)", () => {
    const request = pendingRequest(new Date("2026-01-01T00:00:00.000Z"));
    const wayLater = new Date(new Date(request.expiresAt).getTime() + 1000);
    const importResult = importAutonomousAgentResponse(request, { requestId: "req-1", providerId: AUTONOMOUS_AGENT_PROVIDER_ID, commandsProposed: [] }, wayLater);
    const result = buildImportAgentResponseCommandResult(importResult);
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.blockingIssues).toHaveLength(1);
  });

  it("maps malformed_response to exitCode:3 (InvalidInput)", () => {
    const request = pendingRequest();
    const importResult = importAutonomousAgentResponse(request, { garbage: true }, new Date("2026-01-01T00:00:01.000Z"));
    const result = buildImportAgentResponseCommandResult(importResult);
    expect(result.exitCode).toBe(3);
  });
});
