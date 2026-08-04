import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { makeTempDir, removeDir } from "../helpers.js";
import { generateAgentRequestId, isValidAgentRequestId, saveAgentRequest, loadAgentRequest } from "../../src/services/autonomous-agent-request-store.js";
import { buildAutonomousAgentRequest } from "../../src/workflow/autonomous-agent-request-builder.js";
import type { AutonomousCandidate, AutonomousBudgets, AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";

/**
 * M37-WU03: persistence for AutonomousAgentRequest. Plain filesystem I/O
 * only -- no subprocess.
 */
function candidate(): AutonomousCandidate {
  return {
    issueId: "ISSUE-1",
    source: "manual",
    repository: "/some/repo",
    baseRef: "HEAD",
    objective: "fix something",
    acceptanceCriteria: ["it works"],
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

describe("generateAgentRequestId / isValidAgentRequestId (M37-WU03, pure)", () => {
  it("generates ids matching its own valid-shape check", () => {
    expect(isValidAgentRequestId(generateAgentRequestId())).toBe(true);
  });

  it("rejects a path-traversal-shaped value", () => {
    expect(isValidAgentRequestId("../../etc/passwd")).toBe(false);
  });

  it("rejects an arbitrary operator-supplied string", () => {
    expect(isValidAgentRequestId("my-request")).toBe(false);
  });
});

describe("saveAgentRequest / loadAgentRequest (M37-WU03, real disposable directory)", () => {
  it("saves and loads a round-trip-identical request", () => {
    const dir = makeTempDir("aiqt-agent-request-store-");
    try {
      const request = buildAutonomousAgentRequest({ requestId: generateAgentRequestId(), runId: "run-1", candidate: candidate(), budgets, policy });
      saveAgentRequest(request, dir);
      const loaded = loadAgentRequest(request.requestId, dir);
      expect(loaded).toEqual({ ok: true, request });
    } finally {
      removeDir(dir);
    }
  });

  it("creates the evidence directory if it does not yet exist", () => {
    const dir = join(makeTempDir("aiqt-agent-request-parent-"), "nested", "evidence");
    try {
      expect(existsSync(dir)).toBe(false);
      saveAgentRequest(buildAutonomousAgentRequest({ requestId: generateAgentRequestId(), runId: "run-1", candidate: candidate(), budgets, policy }), dir);
      expect(existsSync(dir)).toBe(true);
    } finally {
      removeDir(dir);
    }
  });

  it("fails closed with a reason when loading a nonexistent request id", () => {
    const dir = makeTempDir("aiqt-agent-request-store-");
    try {
      const result = loadAgentRequest(generateAgentRequestId(), dir);
      expect(result.ok).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it("fails closed for an invalid request id shape without ever touching the filesystem", () => {
    const dir = makeTempDir("aiqt-agent-request-store-");
    try {
      const result = loadAgentRequest("../../etc/passwd", dir);
      expect(result).toEqual({ ok: false, reason: '"../../etc/passwd" is not a valid agent request id.' });
    } finally {
      removeDir(dir);
    }
  });

  it("rejects a request file that fails schema validation", () => {
    const dir = makeTempDir("aiqt-agent-request-store-");
    try {
      const requestId = generateAgentRequestId();
      const request = buildAutonomousAgentRequest({ requestId, runId: "run-1", candidate: candidate(), budgets, policy });
      saveAgentRequest({ ...request, status: "not-a-real-status" as never }, dir);
      const result = loadAgentRequest(requestId, dir);
      expect(result.ok).toBe(false);
    } finally {
      removeDir(dir);
    }
  });
});
