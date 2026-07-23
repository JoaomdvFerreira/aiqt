import { describe, it, expect } from "vitest";
import { applyExecutionProtocolEnvelope, type SessionOpenContext } from "../../src/workflow/execution-envelope-engine.js";
import type { ExecutionSession } from "../../src/schema/execution-session.schema.js";
import type { ExecutionProtocolEnvelope } from "../../src/schema/execution-protocol-envelope.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-08T00:00:00.000Z"; // T1 + 7 days exactly
const T3 = "2026-01-08T00:00:01.000Z"; // T1 + 7 days + 1 second

function openContext(overrides: Partial<SessionOpenContext> = {}): SessionOpenContext {
  return {
    projectId: "P001",
    currentWorkUnitId: "WU001",
    currentWorkUnitInProgress: true,
    currentPacketId: "PKT-001",
    packetHasCheckpoint: false,
    workspaceRef: { mode: "none" },
    sessionsForWorkUnitCount: 0,
    totalSessionsCount: 0,
    nonTerminalSessionExistsForPacket: false,
    ...overrides,
  };
}

function envelope(events: ExecutionProtocolEnvelope["events"], overrides: Partial<ExecutionProtocolEnvelope> = {}): ExecutionProtocolEnvelope {
  return {
    protocolVersion: "long-running-execution-protocol@1",
    providerId: "example.provider",
    sessionClientKey: "client-1",
    events,
    ...overrides,
  };
}

function noEvidence(): boolean {
  return false;
}
function alwaysEvidence(): boolean {
  return true;
}

describe("applyExecutionProtocolEnvelope: session.opened (M26 §4.2/§4.3)", () => {
  it("creates a new session on first open", () => {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const result = applyExecutionProtocolEnvelope({ sessions: [], envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("created");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.status).toBe("planned");
    expect(result.sessions[0]!.workUnitId).toBe("WU001");
    expect(result.sessions[0]!.packetId).toBe("PKT-001");
  });

  it("is a no-op when the identical session.opened event is replayed", () => {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const first = applyExecutionProtocolEnvelope({ sessions: [], envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    if (!first.ok) throw new Error("expected ok");
    const second = applyExecutionProtocolEnvelope({ sessions: first.sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome).toBe("no_op");
    expect(second.changed).toBe(false);
    expect(second.sessions).toEqual(first.sessions);
  });

  it("rejects a conflicting replay of session.opened with different content (exit-3-shaped, no mutation)", () => {
    const env1 = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const first = applyExecutionProtocolEnvelope({ sessions: [], envelope: env1, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    if (!first.ok) throw new Error("expected ok");
    const env2 = envelope([{ type: "session.opened", eventId: "E1", at: T1, externalSessionId: "different" }]);
    const second = applyExecutionProtocolEnvelope({ sessions: first.sessions, envelope: env2, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.category).toBe("invalid");
  });

  it("rejects session open when the current Work Unit is not in_progress", () => {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const result = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: env,
      effectiveNow: T1,
      openContext: openContext({ currentWorkUnitInProgress: false }),
      evidenceExists: noEvidence,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects session open when the packet already has a checkpoint", () => {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const result = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: env,
      effectiveNow: T1,
      openContext: openContext({ packetHasCheckpoint: true }),
      evidenceExists: noEvidence,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects session open when a non-terminal session already exists for the packet", () => {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const result = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: env,
      effectiveNow: T1,
      openContext: openContext({ nonTerminalSessionExistsForPacket: true }),
      evidenceExists: noEvidence,
    });
    expect(result.ok).toBe(false);
  });

  it("blocks session open when max_sessions is reached", () => {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const result = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: env,
      effectiveNow: T1,
      openContext: openContext({ totalSessionsCount: 1000 }),
      evidenceExists: noEvidence,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.category).toBe("blocked");
  });

  it("produces a deterministic identity independent of call order for the same tuple", () => {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const a = applyExecutionProtocolEnvelope({ sessions: [], envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    const b = applyExecutionProtocolEnvelope({ sessions: [], envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.sessions[0]!.id).toBe(b.sessions[0]!.id);
  });
});

describe("applyExecutionProtocolEnvelope: iterations and decisions (M26 §3.4)", () => {
  function openedSessions(): ExecutionSession[] {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const result = applyExecutionProtocolEnvelope({ sessions: [], envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    if (!result.ok) throw new Error("expected ok");
    return result.sessions;
  }

  it("starts and finishes an iteration, assigning sequence 1", () => {
    const sessions = openedSessions();
    const env = envelope([
      { type: "iteration.started", eventId: "E2", at: T1, providerIterationKey: "iter-1" },
      { type: "iteration.finished", eventId: "E3", at: T1, providerIterationKey: "iter-1", status: "completed" },
    ]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.sessions.find((s) => s.id === sessions[0]!.id)!;
    expect(session.iterations).toHaveLength(1);
    expect(session.iterations[0]!.sequence).toBe(1);
    expect(session.iterations[0]!.status).toBe("completed");
  });

  it("rejects a second iteration.started while one is still running", () => {
    const sessions = openedSessions();
    const env = envelope([
      { type: "iteration.started", eventId: "E2", at: T1, providerIterationKey: "iter-1" },
      { type: "iteration.started", eventId: "E3", at: T1, providerIterationKey: "iter-2" },
    ]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
  });

  it("rejects iteration.finished with no matching running iteration (no event implicitly finishes an iteration)", () => {
    const sessions = openedSessions();
    const env = envelope([{ type: "iteration.finished", eventId: "E2", at: T1, providerIterationKey: "never-started", status: "completed" }]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
  });

  it("rejects the entire envelope (atomic, no partial mutation) when a later event in the batch is invalid", () => {
    const sessions = openedSessions();
    const env = envelope([
      { type: "iteration.started", eventId: "E2", at: T1, providerIterationKey: "iter-1" },
      { type: "iteration.started", eventId: "E3", at: T1, providerIterationKey: "iter-2" }, // invalid: one already running
    ]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
    // Original sessions array (pre-envelope) is untouched -- caller never sees a partial iteration.started applied.
    expect(sessions[0]!.iterations).toHaveLength(0);
  });

  it("requests and resolves a decision", () => {
    const sessions = openedSessions();
    const env = envelope([
      { type: "decision.requested", eventId: "E2", at: T1, providerDecisionKey: "dec-1", title: "t", question: "q" },
      { type: "decision.resolved", eventId: "E3", at: T1, providerDecisionKey: "dec-1", selectedOption: "a" },
    ]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.sessions[0]!;
    expect(session.decisions).toHaveLength(1);
    expect(session.decisions[0]!.status).toBe("resolved");
    expect(session.decisions[0]!.selectedOption).toBe("a");
  });

  it("rejects decision.resolved with no matching open decision", () => {
    const sessions = openedSessions();
    const env = envelope([{ type: "decision.resolved", eventId: "E2", at: T1, providerDecisionKey: "never-requested" }]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
  });
});

describe("applyExecutionProtocolEnvelope: status transitions, completion gate (M26 §4.1)", () => {
  function openedSessions(): ExecutionSession[] {
    const env = envelope([{ type: "session.opened", eventId: "E1", at: T1 }]);
    const result = applyExecutionProtocolEnvelope({ sessions: [], envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    if (!result.ok) throw new Error("expected ok");
    return result.sessions;
  }

  it("rejects an invalid transition (e.g. planned -> stale -> completed directly)", () => {
    const sessions = openedSessions();
    const env = envelope([{ type: "session.status_changed", eventId: "E2", at: T1, toStatus: "completed", reason: "done" }]);
    // planned -> completed is not in the allowed table.
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
  });

  it("rejects completed while an iteration is running", () => {
    const sessions = openedSessions();
    const env = envelope([
      { type: "session.status_changed", eventId: "E2", at: T1, toStatus: "running", reason: "start" },
      { type: "iteration.started", eventId: "E3", at: T1, providerIterationKey: "iter-1" },
      { type: "session.status_changed", eventId: "E4", at: T1, toStatus: "completed", reason: "done" },
    ]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
  });

  it("rejects completed while a decision remains open", () => {
    const sessions = openedSessions();
    const env = envelope([
      { type: "session.status_changed", eventId: "E2", at: T1, toStatus: "running", reason: "start" },
      { type: "decision.requested", eventId: "E3", at: T1, providerDecisionKey: "dec-1", title: "t", question: "q" },
      { type: "session.status_changed", eventId: "E4", at: T1, toStatus: "completed", reason: "done" },
    ]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
  });

  it("allows completed once the running iteration is finished and decision resolved", () => {
    const sessions = openedSessions();
    const env = envelope([
      { type: "session.status_changed", eventId: "E2", at: T1, toStatus: "running", reason: "start" },
      { type: "iteration.started", eventId: "E3", at: T1, providerIterationKey: "iter-1" },
      { type: "decision.requested", eventId: "E4", at: T1, providerDecisionKey: "dec-1", title: "t", question: "q" },
      { type: "iteration.finished", eventId: "E5", at: T1, providerIterationKey: "iter-1", status: "completed" },
      { type: "decision.resolved", eventId: "E6", at: T1, providerDecisionKey: "dec-1" },
      { type: "session.status_changed", eventId: "E7", at: T1, toStatus: "completed", reason: "done" },
    ]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.sessions[0]!;
    expect(session.status).toBe("completed");
    expect(session.terminalAt).toBe(T1);
  });
});

describe("applyExecutionProtocolEnvelope: terminal grace window (M26 §4.3)", () => {
  function terminalSession(): ExecutionSession[] {
    const opened = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: envelope([{ type: "session.opened", eventId: "E1", at: T1 }]),
      effectiveNow: T1,
      openContext: openContext(),
      evidenceExists: noEvidence,
    });
    if (!opened.ok) throw new Error("expected ok");
    const cancelled = applyExecutionProtocolEnvelope({
      sessions: opened.sessions,
      envelope: envelope([{ type: "session.status_changed", eventId: "E2", at: T1, toStatus: "cancelled", reason: "stopped" }]),
      effectiveNow: T1,
      openContext: openContext(),
      evidenceExists: noEvidence,
    });
    if (!cancelled.ok) throw new Error("expected ok");
    return cancelled.sessions;
  }

  it("rejects any status/iteration/decision/budget/rollback mutation on a terminal session", () => {
    const sessions = terminalSession();
    const env = envelope([{ type: "iteration.started", eventId: "E3", at: T1, providerIterationKey: "iter-1" }]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T1, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.category).toBe("invalid");
  });

  it("accepts a summary update exactly at the terminalAt + 7 days boundary (inclusive)", () => {
    const sessions = terminalSession();
    const env = envelope([{ type: "session.summary_updated", eventId: "E3", at: T2, learningSummary: "learned something" }]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T2, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(true);
  });

  it("rejects a summary update one second after the terminalAt + 7 days boundary (exit-2-shaped)", () => {
    const sessions = terminalSession();
    const env = envelope([{ type: "session.summary_updated", eventId: "E3", at: T3, learningSummary: "too late" }]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T3, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.category).toBe("blocked");
  });

  it("accepts a references-added update within the grace window and validates evidence refs", () => {
    const sessions = terminalSession();
    const env = envelope([{ type: "session.references_added", eventId: "E3", at: T2, evidenceRefs: ["EVID-001"] }]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T2, openContext: openContext(), evidenceExists: alwaysEvidence });
    expect(result.ok).toBe(true);
  });

  it("rejects a references-added update with an evidence ref that does not resolve", () => {
    const sessions = terminalSession();
    const env = envelope([{ type: "session.references_added", eventId: "E3", at: T2, evidenceRefs: ["EVID-NOPE"] }]);
    const result = applyExecutionProtocolEnvelope({ sessions, envelope: env, effectiveNow: T2, openContext: openContext(), evidenceExists: noEvidence });
    expect(result.ok).toBe(false);
  });
});

describe("applyExecutionProtocolEnvelope: budgets (M26 §3.5)", () => {
  it("recomputes budgetState to 'within' below all thresholds", () => {
    const opened = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: envelope([{ type: "session.opened", eventId: "E1", at: T1, budgets: { maxIterations: 10 } }]),
      effectiveNow: T1,
      openContext: openContext(),
      evidenceExists: noEvidence,
    });
    if (!opened.ok) throw new Error("expected ok");
    expect(opened.sessions[0]!.budgetState).toBe("within");
  });

  it("recomputes budgetState to 'exceeded' once iterations exceed maxIterations", () => {
    const opened = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: envelope([{ type: "session.opened", eventId: "E1", at: T1, budgets: { maxIterations: 1 } }]),
      effectiveNow: T1,
      openContext: openContext(),
      evidenceExists: noEvidence,
    });
    if (!opened.ok) throw new Error("expected ok");
    const run1 = applyExecutionProtocolEnvelope({
      sessions: opened.sessions,
      envelope: envelope([
        { type: "iteration.started", eventId: "E2", at: T1, providerIterationKey: "iter-1" },
        { type: "iteration.finished", eventId: "E3", at: T1, providerIterationKey: "iter-1", status: "completed" },
      ]),
      effectiveNow: T1,
      openContext: openContext(),
      evidenceExists: noEvidence,
    });
    if (!run1.ok) throw new Error("expected ok");
    const run2 = applyExecutionProtocolEnvelope({
      sessions: run1.sessions,
      envelope: envelope([
        { type: "iteration.started", eventId: "E4", at: T1, providerIterationKey: "iter-2" },
        { type: "iteration.finished", eventId: "E5", at: T1, providerIterationKey: "iter-2", status: "completed" },
      ]),
      effectiveNow: T1,
      openContext: openContext(),
      evidenceExists: noEvidence,
    });
    if (!run2.ok) throw new Error("expected ok");
    expect(run2.sessions[0]!.budgetState).toBe("exceeded");
  });

  it("reports 'not_configured' when no budgets are set", () => {
    const opened = applyExecutionProtocolEnvelope({
      sessions: [],
      envelope: envelope([{ type: "session.opened", eventId: "E1", at: T1 }]),
      effectiveNow: T1,
      openContext: openContext(),
      evidenceExists: noEvidence,
    });
    if (!opened.ok) throw new Error("expected ok");
    expect(opened.sessions[0]!.budgetState).toBe("not_configured");
  });
});
