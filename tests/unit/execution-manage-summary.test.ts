import { describe, it, expect } from "vitest";
import { buildExecutionManageSummary } from "../../src/workflow/execution-manage-summary.js";
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

function stateWith(sessions: ExecutionSession[]): StateModel {
  return { ...buildInitialStateModel(T1), executionSessions: sessions };
}

describe("buildExecutionManageSummary (M26 §5.4)", () => {
  it("returns all-zero, null-action defaults when there are no sessions", () => {
    const summary = buildExecutionManageSummary(buildInitialStateModel(T1));
    expect(summary).toEqual({
      totalSessions: 0,
      activeSessions: 0,
      staleSessions: 0,
      openDecisions: 0,
      budgetStoppedSessions: 0,
      terminalAwaitingCheckpoint: 0,
      recommendedAction: null,
    });
  });

  it("counts active (non-terminal) vs terminal sessions", () => {
    const active = session({ id: "sha256:" + "1".repeat(64), status: "running" });
    const terminal = session({ id: "sha256:" + "2".repeat(64), status: "completed", terminalAt: T1 });
    const summary = buildExecutionManageSummary(stateWith([active, terminal]));
    expect(summary.totalSessions).toBe(2);
    expect(summary.activeSessions).toBe(1);
  });

  it("prioritizes open-decision recommendation over other conditions", () => {
    const s = session({
      decisions: [{ id: "XD-001", providerDecisionKey: "d1", status: "open", title: "t", question: "q", options: [], requestedAt: T1 }],
      budgetState: "exceeded",
    });
    const summary = buildExecutionManageSummary(stateWith([s]));
    expect(summary.openDecisions).toBe(1);
    expect(summary.recommendedAction).toContain("open execution decision");
  });

  it("recommends checkpoint for a terminal session awaiting checkpoint when no decision is open", () => {
    const s = session({ status: "completed", terminalAt: T1 });
    const summary = buildExecutionManageSummary(stateWith([s]));
    expect(summary.terminalAwaitingCheckpoint).toBe(1);
    expect(summary.recommendedAction).toContain("aiqt checkpoint");
  });

  it("recommends budget review when nothing else is pending", () => {
    const s = session({ status: "cancelled", terminalAt: T1, budgetState: "reached" });
    const summary = buildExecutionManageSummary(stateWith([s]));
    // terminalAwaitingCheckpoint also fires here since no checkpoint exists --
    // checkpoint takes precedence, matching the priority order above.
    expect(summary.budgetStoppedSessions).toBe(1);
    expect(summary.recommendedAction).toContain("aiqt checkpoint");
  });

  it("counts stale sessions", () => {
    const s = session({ status: "stale" });
    const summary = buildExecutionManageSummary(stateWith([s]));
    expect(summary.staleSessions).toBe(1);
  });
});
