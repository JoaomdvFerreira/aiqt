import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { makeTempDir, removeDir } from "../helpers.js";
import {
  generateAutonomousRunId,
  isValidAutonomousRunId,
  saveAutonomousRunRecord,
  loadAutonomousRunRecord,
  listAutonomousRunIds,
  deleteAutonomousRunRecord,
} from "../../src/services/autonomous-run-store.js";
import type { AutonomousRunRecord } from "../../src/schema/autonomous-run-record.schema.js";

/**
 * M37-WU01: the persistence layer for CLI-visible autonomous runs. Plain
 * filesystem I/O only -- no subprocess.
 */
function record(overrides: Partial<AutonomousRunRecord> = {}): AutonomousRunRecord {
  return {
    runId: generateAutonomousRunId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "classified",
    repositoryPath: "/some/repo",
    baseCommit: "abc123",
    candidate: {
      issueId: "ISSUE-1",
      source: "manual",
      repository: "/some/repo",
      baseRef: "HEAD",
      objective: "fix something",
      acceptanceCriteria: ["it works"],
      constraints: [],
      requestedPermissions: [],
    },
    safetyAssessment: {
      riskClass: "low_risk_autonomous",
      prohibitedAreas: [],
      requiredApprovals: [],
      commandPolicyProfile: "standard",
      networkPolicy: "denied",
      reason: "clean",
    },
    budgets: { maxWallClockSeconds: 60, maxCommandCount: 5, maxRetryCount: 1, maxChangedFiles: 5, maxDiffLines: 100, maxValidationSeconds: 60 },
    policy: {
      allowedCommandClasses: ["read_only_inspection"],
      blockedCommandClasses: ["destructive", "privileged"],
      networkPolicy: "denied",
      filesystemBoundary: "/tmp/wt",
      gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
    },
    approval: null,
    evidencePacket: null,
    auditLog: [],
    agentRequestId: null,
    targetedValidationCommands: [],
    authoritativeValidationCommands: [],
    sandboxContainerId: null,
    sandboxEvidence: null,
    ...overrides,
  };
}

describe("generateAutonomousRunId / isValidAutonomousRunId (M37-WU01, pure)", () => {
  it("generates ids matching its own valid-shape check", () => {
    const id = generateAutonomousRunId();
    expect(isValidAutonomousRunId(id)).toBe(true);
  });

  it("rejects a path-traversal-shaped value", () => {
    expect(isValidAutonomousRunId("../../etc/passwd")).toBe(false);
  });

  it("rejects an arbitrary operator-supplied string", () => {
    expect(isValidAutonomousRunId("my-run")).toBe(false);
  });

  it("generates unique ids across calls", () => {
    const a = generateAutonomousRunId();
    const b = generateAutonomousRunId();
    expect(a).not.toBe(b);
  });
});

describe("save/load/list/delete AutonomousRunRecord (M37-WU01, real disposable directory)", () => {
  it("saves and loads a round-trip-identical record", () => {
    const dir = makeTempDir("aiqt-run-store-");
    try {
      const r = record();
      saveAutonomousRunRecord(r, dir);
      const loaded = loadAutonomousRunRecord(r.runId, dir);
      expect(loaded).toEqual({ ok: true, record: r });
    } finally {
      removeDir(dir);
    }
  });

  it("creates the evidence directory if it does not yet exist", () => {
    const dir = join(makeTempDir("aiqt-run-store-parent-"), "nested", "evidence");
    try {
      expect(existsSync(dir)).toBe(false);
      saveAutonomousRunRecord(record(), dir);
      expect(existsSync(dir)).toBe(true);
    } finally {
      removeDir(dir);
    }
  });

  it("fails closed with a reason when loading a nonexistent run id", () => {
    const dir = makeTempDir("aiqt-run-store-");
    try {
      const result = loadAutonomousRunRecord(generateAutonomousRunId(), dir);
      expect(result.ok).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it("fails closed for an invalid run id shape without ever touching the filesystem", () => {
    const dir = makeTempDir("aiqt-run-store-");
    try {
      const result = loadAutonomousRunRecord("../../etc/passwd", dir);
      expect(result).toEqual({ ok: false, reason: '"../../etc/passwd" is not a valid autonomous run id.' });
    } finally {
      removeDir(dir);
    }
  });

  it("lists exactly the saved run ids, sorted", () => {
    const dir = makeTempDir("aiqt-run-store-");
    try {
      const a = record();
      const b = record();
      saveAutonomousRunRecord(a, dir);
      saveAutonomousRunRecord(b, dir);
      expect(listAutonomousRunIds(dir).sort()).toEqual([a.runId, b.runId].sort());
    } finally {
      removeDir(dir);
    }
  });

  it("lists no ids for a directory that does not exist", () => {
    expect(listAutonomousRunIds(join(makeTempDir("aiqt-run-store-"), "does-not-exist"))).toEqual([]);
  });

  it("deletes exactly the one named run record and nothing else", () => {
    const dir = makeTempDir("aiqt-run-store-");
    try {
      const a = record();
      const b = record();
      saveAutonomousRunRecord(a, dir);
      saveAutonomousRunRecord(b, dir);
      const deleted = deleteAutonomousRunRecord(a.runId, dir);
      expect(deleted).toEqual({ ok: true });
      expect(listAutonomousRunIds(dir)).toEqual([b.runId]);
    } finally {
      removeDir(dir);
    }
  });

  it("refuses to delete an invalid run id shape (path-traversal-proof)", () => {
    const dir = makeTempDir("aiqt-run-store-");
    try {
      const result = deleteAutonomousRunRecord("../../etc/passwd", dir);
      expect(result.ok).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it("rejects a run record file that fails schema validation", () => {
    const dir = makeTempDir("aiqt-run-store-");
    try {
      const id = generateAutonomousRunId();
      saveAutonomousRunRecord({ ...record({ runId: id }), status: "not-a-real-status" as never }, dir);
      const result = loadAutonomousRunRecord(id, dir);
      expect(result.ok).toBe(false);
    } finally {
      removeDir(dir);
    }
  });
});
