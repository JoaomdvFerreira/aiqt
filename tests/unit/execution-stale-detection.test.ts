import { describe, it, expect } from "vitest";
import {
  computeStaleDeadline,
  isStaleEligible,
  findStaleEligibleSessions,
  applyStaleTransitions,
} from "../../src/workflow/execution-stale-detection.js";
import type { ExecutionSession } from "../../src/schema/execution-session.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T1_PLUS_3600S = "2026-01-01T01:00:00.000Z";
const T1_PLUS_3601S = "2026-01-01T01:00:01.000Z";

function session(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: "sha256:" + "a".repeat(64),
    protocolVersion: "long-running-execution-protocol@1",
    sessionClientKey: "client-1",
    provider: { providerId: "example.provider" },
    workUnitId: "WU001",
    packetId: "PKT-001",
    workspaceRef: { mode: "none" },
    status: "running",
    budgetState: "not_configured",
    iterations: [],
    decisions: [],
    rollbackRecords: [],
    commitRefs: [],
    evidenceRefs: [],
    statusTransitions: [],
    eventReceipts: [],
    createdAt: T1,
    updatedAt: T1,
    lastActivityAt: T1,
    ...overrides,
  };
}

describe("computeStaleDeadline / isStaleEligible (M26 §4.4)", () => {
  it("returns null when staleAfterSeconds is not configured", () => {
    expect(computeStaleDeadline(session())).toBeNull();
  });

  it("computes lastActivityAt + staleAfterSeconds", () => {
    const s = session({ budgets: { staleAfterSeconds: 3600 } });
    expect(computeStaleDeadline(s)).toBe(T1_PLUS_3600S);
  });

  it("is not eligible exactly at the deadline (strictly after, not inclusive)", () => {
    const s = session({ budgets: { staleAfterSeconds: 3600 } });
    expect(isStaleEligible(s, T1_PLUS_3600S)).toBe(false);
  });

  it("is eligible one second after the deadline", () => {
    const s = session({ budgets: { staleAfterSeconds: 3600 } });
    expect(isStaleEligible(s, T1_PLUS_3601S)).toBe(true);
  });

  it("is never eligible for a terminal session", () => {
    const s = session({ budgets: { staleAfterSeconds: 3600 }, status: "completed", terminalAt: T1 });
    expect(isStaleEligible(s, T1_PLUS_3601S)).toBe(false);
  });

  it("is never eligible for a session already stale", () => {
    const s = session({ budgets: { staleAfterSeconds: 3600 }, status: "stale" });
    expect(isStaleEligible(s, T1_PLUS_3601S)).toBe(false);
  });

  it("is never eligible when the current status cannot transition to stale (planned can, so use a status the table excludes -- there is none other than terminal/stale, confirmed by the transition table covering every non-terminal status)", () => {
    // Every non-terminal, non-stale status (planned/running/paused/blocked)
    // can reach stale per the §4.1 table -- this test documents that fact
    // rather than asserting a false negative that doesn't exist.
    for (const status of ["planned", "running", "paused", "blocked"] as const) {
      const s = session({ budgets: { staleAfterSeconds: 3600 }, status });
      expect(isStaleEligible(s, T1_PLUS_3601S)).toBe(true);
    }
  });
});

describe("findStaleEligibleSessions / applyStaleTransitions (M26 §4.4)", () => {
  it("finds only the eligible sessions among a mix", () => {
    const eligible = session({ id: "sha256:" + "1".repeat(64), budgets: { staleAfterSeconds: 3600 } });
    const notYet = session({ id: "sha256:" + "2".repeat(64), budgets: { staleAfterSeconds: 3600 }, lastActivityAt: T1_PLUS_3600S });
    const unconfigured = session({ id: "sha256:" + "3".repeat(64) });
    const result = findStaleEligibleSessions([eligible, notYet, unconfigured], T1_PLUS_3601S);
    expect(result.map((r) => r.sessionId)).toEqual([eligible.id]);
  });

  it("applyStaleTransitions transitions exactly the eligible sessions, recording stale_timeout, and leaves others untouched", () => {
    const eligible = session({ id: "sha256:" + "1".repeat(64), budgets: { staleAfterSeconds: 3600 } });
    const notEligible = session({ id: "sha256:" + "2".repeat(64) });
    const result = applyStaleTransitions([eligible, notEligible], T1_PLUS_3601S);
    expect(result.transitionedSessionIds).toEqual([eligible.id]);
    const transitioned = result.sessions.find((s) => s.id === eligible.id)!;
    expect(transitioned.status).toBe("stale");
    expect(transitioned.statusTransitions[transitioned.statusTransitions.length - 1]).toEqual({
      fromStatus: "running",
      toStatus: "stale",
      reason: "stale_timeout",
      at: T1_PLUS_3601S,
    });
    const untouched = result.sessions.find((s) => s.id === notEligible.id)!;
    expect(untouched).toEqual(notEligible);
  });

  it("applying with no eligible sessions is a true no-op (identical session objects)", () => {
    const s = session();
    const result = applyStaleTransitions([s], T1);
    expect(result.transitionedSessionIds).toEqual([]);
    expect(result.sessions[0]).toBe(s);
  });
});
