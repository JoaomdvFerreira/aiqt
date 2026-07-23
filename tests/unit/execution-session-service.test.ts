import { describe, it, expect } from "vitest";
import {
  getExecutionSessions,
  findExecutionSessionById,
  findSessionsForWorkUnit,
  findSessionsForPacket,
  findNonTerminalSessionForPacket,
  findAnySessionForPacket,
} from "../../src/services/execution-session-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ExecutionSession } from "../../src/schema/execution-session.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";

function session(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: "sha256:" + "a".repeat(64),
    protocolVersion: "long-running-execution-protocol@1",
    sessionClientKey: "client-1",
    provider: { providerId: "example.provider" },
    workUnitId: "WU001",
    packetId: "PKT-001",
    workspaceRef: { mode: "none" },
    status: "planned",
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

function stateWith(sessions: ExecutionSession[]): StateModel {
  return { ...buildInitialStateModel(T1), executionSessions: sessions };
}

describe("execution-session-service (M26 §3)", () => {
  it("getExecutionSessions returns an empty array when state.executionSessions is absent", () => {
    expect(getExecutionSessions(buildInitialStateModel(T1))).toEqual([]);
  });

  it("getExecutionSessions returns the populated array", () => {
    const s = session();
    expect(getExecutionSessions(stateWith([s]))).toEqual([s]);
  });

  it("findExecutionSessionById finds by exact id", () => {
    const s = session({ id: "sha256:" + "b".repeat(64) });
    expect(findExecutionSessionById(s.id, [s])?.id).toBe(s.id);
    expect(findExecutionSessionById("sha256:" + "c".repeat(64), [s])).toBeUndefined();
  });

  it("findSessionsForWorkUnit filters by workUnitId", () => {
    const a = session({ id: "sha256:" + "1".repeat(64), workUnitId: "WU001" });
    const b = session({ id: "sha256:" + "2".repeat(64), workUnitId: "WU002" });
    expect(findSessionsForWorkUnit("WU001", [a, b])).toEqual([a]);
  });

  it("findSessionsForPacket filters by packetId", () => {
    const a = session({ id: "sha256:" + "1".repeat(64), packetId: "PKT-001" });
    const b = session({ id: "sha256:" + "2".repeat(64), packetId: "PKT-002" });
    expect(findSessionsForPacket("PKT-001", [a, b])).toEqual([a]);
  });

  it("findNonTerminalSessionForPacket returns undefined when every session for the packet is terminal", () => {
    const a = session({
      id: "sha256:" + "1".repeat(64),
      packetId: "PKT-001",
      status: "completed",
      terminalAt: T1,
    });
    expect(findNonTerminalSessionForPacket("PKT-001", [a])).toBeUndefined();
  });

  it("findNonTerminalSessionForPacket returns the one non-terminal session for the packet", () => {
    const terminal = session({
      id: "sha256:" + "1".repeat(64),
      packetId: "PKT-001",
      status: "failed",
      terminalAt: T1,
    });
    const active = session({ id: "sha256:" + "2".repeat(64), packetId: "PKT-001", status: "running" });
    expect(findNonTerminalSessionForPacket("PKT-001", [terminal, active])?.id).toBe(active.id);
  });

  it("findAnySessionForPacket returns all historical sessions regardless of status", () => {
    const terminal = session({
      id: "sha256:" + "1".repeat(64),
      packetId: "PKT-001",
      status: "completed",
      terminalAt: T1,
    });
    const active = session({ id: "sha256:" + "2".repeat(64), packetId: "PKT-001", status: "running" });
    expect(findAnySessionForPacket("PKT-001", [terminal, active])).toHaveLength(2);
  });
});
